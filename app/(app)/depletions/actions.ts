"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parse } from "csv-parse/sync";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toFloat } from "@/lib/format";

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
