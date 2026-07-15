"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parse } from "csv-parse/sync";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toFloat } from "@/lib/format";

export async function createChannelStock(formData: FormData) {
  await requireOps();
  const holder = String(formData.get("holder") ?? ""); // "imp:<id>" | "dist:<id>"
  const [kind, id] = holder.split(":");
  await db.channelStock.create({
    data: {
      holderType: kind === "imp" ? "IMPORTER" : "DISTRIBUTOR",
      importerId: kind === "imp" ? id : null,
      distributorId: kind === "dist" ? id : null,
      productId: String(formData.get("productId")),
      period: String(formData.get("period") ?? "").trim(),
      cases: toFloat(formData.get("cases") as string),
      source: "MANUAL",
    },
  });
  revalidatePath("/channel");
  revalidatePath("/");
}

export async function deleteChannelStock(formData: FormData) {
  await requireOps();
  await db.channelStock.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/channel");
}

/**
 * CSV import for importer inventory reports (their stock + each distributor's).
 * Expected columns (flexible names): holder, sku, period, cases
 * "holder" is matched against importer names first, then distributor names.
 */
export async function importChannelStock(formData: FormData) {
  await requireOps();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect("/channel?err=No+file+selected");

  let records: Record<string, string>[];
  try {
    records = parse(await file.text(), {
      columns: (header: string[]) =>
        header.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")),
      skip_empty_lines: true,
      trim: true,
    });
  } catch {
    redirect("/channel?err=Could+not+parse+CSV+file");
  }

  const pick = (row: Record<string, string>, keys: string[]) => {
    for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k];
    return "";
  };

  const [importers, distributors, products] = await Promise.all([
    db.importer.findMany(),
    db.distributor.findMany(),
    db.product.findMany(),
  ]);
  const impByName = new Map(importers.map((i) => [i.name.toLowerCase(), i.id]));
  const distByName = new Map(distributors.map((d) => [d.name.toLowerCase(), d.id]));
  const prodBySku = new Map(products.map((p) => [p.sku.toLowerCase(), p.id]));
  const prodByName = new Map(products.map((p) => [p.name.toLowerCase(), p.id]));

  const rows: {
    holderType: string;
    importerId: string | null;
    distributorId: string | null;
    productId: string;
    period: string;
    cases: number;
    source: string;
  }[] = [];
  const skipped: string[] = [];

  records.forEach((row, i) => {
    const line = i + 2;
    const holderName = pick(row, ["holder", "entity", "location", "warehouse", "distributor", "wholesaler"]).toLowerCase();
    const skuOrName = pick(row, ["sku", "product", "product_name", "item", "brand"]).toLowerCase();
    const periodRaw = pick(row, ["period", "month", "date", "as_of"]);
    const cases = toFloat(pick(row, ["cases", "case_equivalents", "qty", "quantity", "on_hand", "9l_cases"]));

    const importerId = impByName.get(holderName) ?? null;
    const distributorId = importerId ? null : (distByName.get(holderName) ?? null);
    const productId = prodBySku.get(skuOrName) ?? prodByName.get(skuOrName);

    let period = "";
    const m = periodRaw.match(/^(\d{4})[-/](\d{1,2})/);
    if (m) period = `${m[1]}-${m[2].padStart(2, "0")}`;
    else {
      const d = new Date(periodRaw);
      if (!isNaN(d.getTime())) period = d.toISOString().slice(0, 7);
    }

    if (!importerId && !distributorId) skipped.push(`Line ${line}: unknown holder "${holderName || "(blank)"}"`);
    else if (!productId) skipped.push(`Line ${line}: unknown product "${skuOrName || "(blank)"}"`);
    else if (!period) skipped.push(`Line ${line}: unreadable period "${periodRaw || "(blank)"}"`);
    else {
      rows.push({
        holderType: importerId ? "IMPORTER" : "DISTRIBUTOR",
        importerId,
        distributorId,
        productId,
        period,
        cases,
        source: "IMPORT",
      });
    }
  });

  if (rows.length > 0) await db.channelStock.createMany({ data: rows });

  revalidatePath("/channel");
  revalidatePath("/");
  const params = new URLSearchParams({ imported: String(rows.length) });
  if (skipped.length > 0) params.set("skipped", skipped.slice(0, 10).join(" | "));
  redirect(`/channel?${params.toString()}`);
}
