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
