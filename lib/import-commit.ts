import { db } from "./db";
import { matchProduct } from "./product-match";
import type { CommercialReport } from "./commercial-report";
import type { LsiInventoryReport } from "./lsi-inventory";

/**
 * Shared commit logic for report imports. Both the direct-upload actions and
 * the staged-approval flow call these, so there is exactly one code path that
 * writes report data — a review-then-approve and a one-click upload commit
 * identically.
 */

export type CommercialCommit = {
  reportPeriod: string;
  months: number;
  depletions: number;
  skuRows: number;
  snapshots: number;
  chains: number;
  warnings: string[];
};

/** Commits a parsed commercial report; replaces report-sourced rows for its months. */
export async function commitCommercialReport(
  report: CommercialReport,
  importerId: string
): Promise<CommercialCommit> {
  const warnings = [...report.warnings];

  // markets → distributors (auto-create by state code)
  const existing = await db.distributor.findMany({ where: { importerId } });
  const byMarket = new Map(existing.map((d) => [(d.market || d.name).toLowerCase(), d.id]));
  const markets = [...new Set(report.depletions.map((d) => d.market))];
  for (const market of markets) {
    if (!byMarket.has(market.toLowerCase())) {
      const created = await db.distributor.create({ data: { importerId, name: market, market } });
      byMarket.set(market.toLowerCase(), created.id);
    }
  }

  // variants → products by tier + size
  const products = await db.product.findMany({ where: { active: true } });
  const productForVariant = new Map<string, string>();
  for (const variant of [...new Set(report.variants.map((v) => v.variant))]) {
    const { product, note } = matchProduct(variant, products);
    if (product) {
      productForVariant.set(variant, product.id);
      if (note) warnings.push(note);
    } else {
      warnings.push(`Variant "${variant}" didn't match any product — skipped.`);
    }
  }

  const periods = [...new Set(report.depletions.map((d) => d.period))];
  const variantPeriods = [...new Set(report.variants.map((v) => v.period))];
  const distributorIds = [...byMarket.values()];

  await db.$transaction([
    db.depletion.deleteMany({
      where: { source: "REPORT", period: { in: periods }, distributorId: { in: distributorIds } },
    }),
    db.depletion.createMany({
      data: report.depletions.map((d) => ({
        distributorId: byMarket.get(d.market.toLowerCase())!,
        productId: null,
        period: d.period,
        cases: d.cases,
        source: "REPORT",
      })),
    }),
    db.skuDepletion.deleteMany({ where: { source: "REPORT", period: { in: variantPeriods } } }),
    db.skuDepletion.createMany({
      data: report.variants
        .filter((v) => productForVariant.has(v.variant))
        .map((v) => ({
          productId: productForVariant.get(v.variant)!,
          period: v.period,
          cases: v.cases,
          source: "REPORT",
        })),
    }),
    db.marketSnapshot.deleteMany({ where: { importerId, period: report.reportPeriod } }),
    db.marketSnapshot.createMany({
      data: report.snapshots.map((s) => ({
        importerId,
        period: report.reportPeriod,
        market: s.market,
        ytdCases: s.ytdCases,
        ytdCasesLY: s.ytdCasesLY,
        accounts: s.accounts,
        accountsLY: s.accountsLY,
        velocity: s.velocity,
      })),
    }),
    db.chainVolume.deleteMany({ where: { importerId, period: report.reportPeriod } }),
    db.chainVolume.createMany({
      data: report.chains.map((c) => ({
        importerId,
        period: report.reportPeriod,
        chain: c.chain,
        ytdCases: c.ytdCases,
        ytdCasesLY: c.ytdCasesLY,
      })),
    }),
  ]);

  return {
    reportPeriod: report.reportPeriod,
    months: periods.length,
    depletions: report.depletions.length,
    skuRows: report.variants.length,
    snapshots: report.snapshots.length,
    chains: report.chains.length,
    warnings,
  };
}

export type LsiCommit = {
  period: string;
  importerRows: number;
  distributorRows: number;
  warnings: string[];
};

/** Commits a parsed LSI inventory workbook as channel stock (phys → 9L). */
export async function commitLsiInventory(
  report: LsiInventoryReport,
  importerId: string,
  period: string
): Promise<LsiCommit> {
  const warnings = [...report.warnings];
  const products = await db.product.findMany({ where: { active: true } });
  const matchNotes = new Set<string>();
  const productFor = (itemName: string) => {
    const { product, note } = matchProduct(itemName, products);
    if (note) matchNotes.add(note);
    return product;
  };
  const to9L = (physCases: number, p: { bottlesPerCase: number; sizeMl: number }) =>
    (physCases * p.bottlesPerCase * p.sizeMl) / 9000;

  const importerByProduct = new Map<string, number>();
  for (const row of report.importerStock) {
    const p = productFor(row.itemName);
    if (!p) {
      warnings.push(`LSI item "${row.itemName}" didn't match a product — skipped.`);
      continue;
    }
    importerByProduct.set(p.id, (importerByProduct.get(p.id) ?? 0) + to9L(row.physCases, p));
  }

  const existing = await db.distributor.findMany({ where: { importerId } });
  const byName = new Map(existing.map((d) => [d.name.toLowerCase(), d.id]));
  const distByProduct = new Map<string, number>();
  for (const row of report.distributorStock) {
    const p = productFor(row.itemName);
    if (!p) {
      warnings.push(`Item "${row.itemName}" didn't match a product — skipped.`);
      continue;
    }
    let distId = byName.get(row.distributor.toLowerCase());
    if (!distId) {
      const created = await db.distributor.create({
        data: { importerId, name: row.distributor, market: row.state },
      });
      distId = created.id;
      byName.set(row.distributor.toLowerCase(), distId);
    }
    const key = `${distId}|${p.id}`;
    distByProduct.set(key, (distByProduct.get(key) ?? 0) + to9L(row.physCases, p));
  }

  const distributorIds = [...byName.values()];
  await db.$transaction([
    db.channelStock.deleteMany({
      where: {
        source: "REPORT",
        period,
        OR: [{ importerId }, { distributorId: { in: distributorIds } }],
      },
    }),
    db.channelStock.createMany({
      data: [
        ...[...importerByProduct.entries()].map(([productId, cases]) => ({
          holderType: "IMPORTER",
          importerId,
          distributorId: null,
          productId,
          period,
          cases: Math.round(cases * 100) / 100,
          source: "REPORT",
        })),
        ...[...distByProduct.entries()].map(([key, cases]) => {
          const [distributorId, productId] = key.split("|");
          return {
            holderType: "DISTRIBUTOR",
            importerId: null,
            distributorId,
            productId,
            period,
            cases: Math.round(cases * 100) / 100,
            source: "REPORT",
          };
        }),
      ],
    }),
  ]);

  return {
    period,
    importerRows: importerByProduct.size,
    distributorRows: distByProduct.size,
    warnings: [...warnings, ...matchNotes],
  };
}

export type QbCommit = { periods: number; rows: number };

/** Commits parsed QB P&L rows; replaces entries for the covered periods. */
export async function commitQbPnl(
  rows: { period: string; account: string; kind: string; amountCents: number }[]
): Promise<QbCommit> {
  const periods = [...new Set(rows.map((r) => r.period))];
  if (rows.length > 0) {
    await db.$transaction([
      db.financialEntry.deleteMany({ where: { period: { in: periods } } }),
      db.financialEntry.createMany({ data: rows }),
    ]);
  }
  return { periods: periods.length, rows: rows.length };
}

// ---------- AI-extracted documents (universal inbox) ----------

import type { AiExtraction, AiRecord } from "./ai-extract";

const dateOr = (s: string, fallback?: Date): Date | null => {
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return fallback ?? null;
};

const pick = (value: string, allowed: string[], fallback: string) =>
  allowed.includes(value) ? value : fallback;

/**
 * Commits a human-approved AI extraction. Deliberately conservative:
 * POs land as ORDERED (receive them in Purchasing to move stock), sales as
 * DRAFT, production runs as PLANNED — approval never moves inventory.
 */
export async function commitAiExtract(x: AiExtraction, importerId: string | null): Promise<string> {
  const now = new Date();
  const docDate = dateOr(x.docDate, now)!;
  const rec = (r: AiRecord) => r; // alias for readability

  if (x.category === "PURCHASE_ORDER") {
    let supplierId = x.entityId;
    if (supplierId && !(await db.supplier.findUnique({ where: { id: supplierId } }))) supplierId = "";
    if (!supplierId) {
      const created = await db.supplier.create({
        data: { name: x.entityName || "Unknown supplier", notes: "Created from inbox import" },
      });
      supplierId = created.id;
    }
    let poNumber = x.reference || `INBOX-${docDate.toISOString().slice(0, 10)}`;
    if (await db.purchaseOrder.findUnique({ where: { poNumber } })) {
      poNumber = `${poNumber}-${Date.now().toString(36)}`;
    }
    const po = await db.purchaseOrder.create({
      data: { poNumber, supplierId, status: "ORDERED", orderDate: docDate, notes: "Imported from inbox — mark received in Purchasing to add stock." },
    });
    let lines = 0;
    for (const r of x.records.map(rec)) {
      let componentId = r.matchedId;
      if (componentId && !(await db.component.findUnique({ where: { id: componentId } }))) componentId = "";
      if (!componentId) {
        const created = await db.component.create({
          data: { name: r.name || "Unnamed component", supplierId, unitCostCents: r.unitCostCents, notes: "Created from inbox import" },
        });
        componentId = created.id;
      }
      await db.purchaseOrderLine.create({
        data: { poId: po.id, componentId, qty: r.qty, unitCostCents: r.unitCostCents },
      });
      lines++;
    }
    return `Created PO ${poNumber} (${lines} lines) as ORDERED — receive it in Purchasing to add stock.`;
  }

  if (x.category === "EXPENSE") {
    const cats = ["COGS", "DRY_GOODS", "LOGISTICS", "COMPLIANCE", "MARKETING", "G_AND_A", "OTHER"];
    let n = 0;
    for (const r of x.records) {
      if (r.amountCents === 0) continue;
      await db.expense.create({
        data: {
          date: dateOr(r.date, docDate)!,
          vendor: r.name || x.entityName || "Unknown vendor",
          category: pick(r.subCategory, cats, "OTHER"),
          amountCents: r.amountCents,
          notes: [r.reference, r.notes].filter(Boolean).join(" — "),
        },
      });
      n++;
    }
    return `Recorded ${n} expense${n === 1 ? "" : "s"}.`;
  }

  if (x.category === "CHARGEBACK") {
    const imp = importerId ?? (await db.importer.findFirst())?.id;
    if (!imp) return "No importer on file — add one first.";
    const cats = ["DISTRIBUTOR_PROMO", "SAMPLES", "FREIGHT", "MARKETING", "OTHER"];
    let n = 0;
    for (const r of x.records) {
      if (r.amountCents === 0) continue;
      await db.chargeback.create({
        data: {
          importerId: imp,
          date: dateOr(r.date, docDate)!,
          category: pick(r.subCategory, cats, "OTHER"),
          amountCents: r.amountCents,
          reference: r.reference || x.reference,
          notes: [r.name, r.notes].filter(Boolean).join(" — "),
        },
      });
      n++;
    }
    return `Recorded ${n} chargeback${n === 1 ? "" : "s"} (unapplied — link to invoices in Accounting).`;
  }

  if (x.category === "LEGAL_RECORD") {
    const types = ["TRADEMARK", "PERMIT", "DOCUMENT", "DEADLINE"];
    let n = 0;
    for (const r of x.records) {
      await db.legalRecord.create({
        data: {
          type: pick(r.subCategory, types, "DOCUMENT"),
          title: r.name || x.entityName || "Imported document",
          reference: r.reference || x.reference,
          executed: dateOr(r.date),
          dueDate: dateOr(r.endDate),
          notes: r.notes,
        },
      });
      n++;
    }
    return `Added ${n} record${n === 1 ? "" : "s"} to the legal register.`;
  }

  if (x.category === "DEPLETION_REPORT") {
    const imp = importerId ?? (await db.importer.findFirst())?.id;
    if (!imp) return "No importer on file — add one first.";
    let distributorId = x.entityId;
    if (distributorId && !(await db.distributor.findUnique({ where: { id: distributorId } }))) distributorId = "";
    if (!distributorId) {
      const created = await db.distributor.create({
        data: { importerId: imp, name: x.entityName || "Unknown distributor", notes: "Created from inbox import" },
      });
      distributorId = created.id;
    }
    const period = /^\d{4}-\d{2}$/.test(x.period) ? x.period : new Date().toISOString().slice(0, 7);
    const acctTypes = ["ON_PREMISE", "OFF_PREMISE", "UNKNOWN"];
    let n = 0;
    for (const r of x.records) {
      if (r.qty === 0) continue;
      await db.depletion.create({
        data: {
          distributorId,
          period,
          accountName: r.name,
          accountType: pick(r.subCategory, acctTypes, "UNKNOWN"),
          cases: r.qty,
          source: "IMPORT",
          productId: (r.matchedId && (await db.product.findUnique({ where: { id: r.matchedId } }))?.id) || null,
        },
      });
      n++;
    }
    return `Imported ${n} account depletion rows for ${period}.`;
  }

  if (x.category === "EX_WORKS_SALE") {
    const imp = (x.entityId && (await db.importer.findUnique({ where: { id: x.entityId } }))?.id) || importerId || (await db.importer.findFirst())?.id;
    const warehouse = await db.warehouse.findFirst();
    if (!imp || !warehouse) return "Need an importer and a warehouse on file first.";
    const sale = await db.exWorksSale.create({
      data: {
        importerId: imp,
        warehouseId: warehouse.id,
        date: docDate,
        status: "DRAFT",
        invoiceNumber: x.reference,
        notes: "Imported from inbox — confirm in Ex-Works Sales to move inventory.",
      },
    });
    let lines = 0;
    let skipped = 0;
    for (const r of x.records) {
      const product = r.matchedId ? await db.product.findUnique({ where: { id: r.matchedId } }) : null;
      if (!product || r.qty === 0) { skipped++; continue; }
      await db.exWorksLine.create({
        data: { saleId: sale.id, productId: product.id, cases: Math.round(r.qty), pricePerCaseCents: r.unitCostCents },
      });
      lines++;
    }
    return `Created DRAFT sale ${x.reference || sale.id.slice(-6)} with ${lines} lines${skipped ? ` (${skipped} unmatched lines skipped)` : ""} — confirm it to move inventory.`;
  }

  if (x.category === "PRODUCTION_RUN") {
    const r = x.records[0];
    const product = r?.matchedId ? await db.product.findUnique({ where: { id: r.matchedId } }) : null;
    const warehouse = await db.warehouse.findFirst();
    if (!r || !product || !warehouse) return "Couldn't match the production run to a product — add it manually in Production.";
    let lotCode = r.reference || r.name || `LOT-${docDate.toISOString().slice(0, 10)}`;
    if (await db.productionRun.findUnique({ where: { lotCode } })) lotCode = `${lotCode}-${Date.now().toString(36)}`;
    await db.productionRun.create({
      data: {
        lotCode,
        productId: product.id,
        warehouseId: warehouse.id,
        status: "PLANNED",
        startDate: dateOr(r.date, docDate)!,
        bottlesPlanned: Math.round(r.qty),
        notes: `Imported from inbox — complete it in Production to add finished goods. ${r.notes}`.trim(),
      },
    });
    return `Created PLANNED production run ${lotCode} (${Math.round(r.qty)} bottles) — complete it in Production to add stock.`;
  }

  return "Nothing to import from this document.";
}
