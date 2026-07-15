"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parse } from "csv-parse/sync";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toFloat } from "@/lib/format";
import { parseCommercialReport } from "@/lib/commercial-report";

/**
 * One-click import for the importer's monthly Commercial Report (.xlsx).
 * - "Dist. STATE" block  → brand-level depletions per market (distributors
 *   auto-created under the importer, named by state)
 * - "Variants" block     → national per-SKU monthly depletions (drives
 *   per-SKU velocity), matched to products by tier keyword
 * - "MARKET" YTD block   → market snapshots (volume / accounts / velocity vs LY)
 * - "TOP 20 CHAIN" block → chain volumes
 * Re-uploading replaces report-sourced rows for the same months, so a newer
 * report (which restates history) is always safe to import.
 */
export async function importCommercialReport(formData: FormData) {
  await requireOps();
  const file = formData.get("file") as File | null;
  const importerId = String(formData.get("importerId") ?? "");
  if (!file || file.size === 0) redirect("/depletions?err=No+file+selected");
  if (!importerId) redirect("/depletions?err=No+importer+selected");

  let report;
  try {
    report = parseCommercialReport(Buffer.from(await file.arrayBuffer()));
  } catch {
    redirect("/depletions?err=Could+not+parse+the+workbook");
  }
  const warnings = [...report.warnings];

  // --- markets → distributors (auto-create by state code) ---
  const existing = await db.distributor.findMany({ where: { importerId } });
  const byMarket = new Map(
    existing.map((d) => [(d.market || d.name).toLowerCase(), d.id])
  );
  const markets = [...new Set(report.depletions.map((d) => d.market))];
  for (const market of markets) {
    if (!byMarket.has(market.toLowerCase())) {
      const created = await db.distributor.create({
        data: { importerId, name: market, market },
      });
      byMarket.set(market.toLowerCase(), created.id);
    }
  }

  // --- variants → products by tier keyword ---
  const products = await db.product.findMany({ where: { active: true } });
  const tierOf = (variant: string) =>
    /cristalino/i.test(variant) ? "OTHER"
    : /a[nñ]ejo/i.test(variant) ? "ANEJO"
    : /reposado/i.test(variant) ? "REPOSADO"
    : /blanco/i.test(variant) ? "BLANCO"
    : null;
  const productForVariant = new Map<string, string>();
  for (const variant of [...new Set(report.variants.map((v) => v.variant))]) {
    const tier = tierOf(variant);
    const match =
      products.find((p) => p.name.toLowerCase() === variant.toLowerCase()) ??
      (tier ? products.find((p) => p.tier === tier) : undefined);
    if (match) productForVariant.set(variant, match.id);
    else warnings.push(`Variant "${variant}" didn't match any product — skipped.`);
  }

  const periods = [...new Set(report.depletions.map((d) => d.period))];
  const variantPeriods = [...new Set(report.variants.map((v) => v.period))];
  const distributorIds = [...byMarket.values()];

  await db.$transaction([
    // replace report-sourced market depletions for the file's months
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
    // replace per-SKU national depletions
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
    // replace snapshots + chain volumes for this report month
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

  revalidatePath("/depletions");
  revalidatePath("/channel");
  revalidatePath("/partners");
  revalidatePath("/");
  const params = new URLSearchParams({
    report: report.reportPeriod,
    months: String(periods.length),
    records: String(report.depletions.length),
    sku: String(report.variants.length),
    snapshots: String(report.snapshots.length),
    chains: String(report.chains.length),
  });
  if (warnings.length > 0) params.set("skipped", warnings.slice(0, 8).join(" | "));
  redirect(`/depletions?${params.toString()}`);
}

export async function createDepletion(formData: FormData) {
  await requireOps();
  await db.depletion.create({
    data: {
      distributorId: String(formData.get("distributorId")),
      productId: String(formData.get("productId")),
      period: String(formData.get("period") ?? "").trim(),
      accountName: String(formData.get("accountName") ?? "").trim(),
      accountType: String(formData.get("accountType") ?? "UNKNOWN"),
      cases: toFloat(formData.get("cases") as string),
      source: "MANUAL",
    },
  });
  revalidatePath("/depletions");
}

export async function deleteDepletion(formData: FormData) {
  await requireOps();
  await db.depletion.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/depletions");
}

/**
 * CSV import for depletion reports (VIP/iDIG exports, distributor spreadsheets).
 * Flexible header matching — expects columns like:
 *   distributor, sku (or product), period (or month/date), cases,
 *   account (optional), account_type (optional: on/off premise)
 * Distributors and products are matched by name/SKU (case-insensitive).
 * Unmatched rows are skipped and reported, never silently dropped.
 */
export async function importDepletions(formData: FormData) {
  await requireOps();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect("/depletions?err=No+file+selected");

  let records: Record<string, string>[];
  try {
    const text = await file.text();
    records = parse(text, {
      columns: (header: string[]) =>
        header.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")),
      skip_empty_lines: true,
      trim: true,
    });
  } catch {
    redirect("/depletions?err=Could+not+parse+CSV+file");
  }

  const pick = (row: Record<string, string>, keys: string[]) => {
    for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k];
    return "";
  };

  const [distributors, products] = await Promise.all([
    db.distributor.findMany(),
    db.product.findMany(),
  ]);
  const distByName = new Map(distributors.map((d) => [d.name.toLowerCase(), d.id]));
  const prodBySku = new Map(products.map((p) => [p.sku.toLowerCase(), p.id]));
  const prodByName = new Map(products.map((p) => [p.name.toLowerCase(), p.id]));

  let imported = 0;
  const skipped: string[] = [];

  const rows: {
    distributorId: string;
    productId: string;
    period: string;
    accountName: string;
    accountType: string;
    cases: number;
    source: string;
  }[] = [];

  records.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const distName = pick(row, ["distributor", "distributor_name", "wholesaler"]).toLowerCase();
    const skuOrName = pick(row, ["sku", "product", "product_name", "item", "brand"]).toLowerCase();
    const periodRaw = pick(row, ["period", "month", "date", "period_month"]);
    const cases = toFloat(pick(row, ["cases", "case_equivalents", "qty", "quantity", "9l_cases"]));

    const distributorId = distByName.get(distName);
    const productId = prodBySku.get(skuOrName) ?? prodByName.get(skuOrName);

    // normalize period to YYYY-MM
    let period = "";
    const m = periodRaw.match(/^(\d{4})[-/](\d{1,2})/);
    if (m) period = `${m[1]}-${m[2].padStart(2, "0")}`;
    else {
      const d = new Date(periodRaw);
      if (!isNaN(d.getTime())) period = d.toISOString().slice(0, 7);
    }

    if (!distributorId) skipped.push(`Line ${line}: unknown distributor "${distName || "(blank)"}"`);
    else if (!productId) skipped.push(`Line ${line}: unknown product "${skuOrName || "(blank)"}"`);
    else if (!period) skipped.push(`Line ${line}: unreadable period "${periodRaw || "(blank)"}"`);
    else if (cases === 0) skipped.push(`Line ${line}: zero/unreadable case count`);
    else {
      const typeRaw = pick(row, ["account_type", "premise", "channel"]).toLowerCase();
      rows.push({
        distributorId,
        productId,
        period,
        accountName: pick(row, ["account", "account_name", "retailer"]),
        accountType: typeRaw.includes("on") ? "ON_PREMISE" : typeRaw.includes("off") ? "OFF_PREMISE" : "UNKNOWN",
        cases,
        source: "IMPORT",
      });
    }
  });

  if (rows.length > 0) {
    await db.depletion.createMany({ data: rows });
    imported = rows.length;
  }

  revalidatePath("/depletions");
  const params = new URLSearchParams({ imported: String(imported) });
  if (skipped.length > 0) params.set("skipped", skipped.slice(0, 10).join(" | "));
  redirect(`/depletions?${params.toString()}`);
}
