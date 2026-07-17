"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toCents, toInt, toFloat } from "@/lib/format";
import { recalcProductCosts } from "@/lib/bom-cost";

export async function createProduct(formData: FormData) {
  await requireOps();
  const sku = String(formData.get("sku") ?? "").trim().toUpperCase();
  if (await db.product.findUnique({ where: { sku } })) {
    const { redirect } = await import("next/navigation");
    redirect(`/products?err=${encodeURIComponent(`SKU ${sku} already exists — pick another.`)}`);
  }
  await db.product.create({
    data: {
      sku,
      name: String(formData.get("name") ?? "").trim(),
      tier: String(formData.get("tier") ?? "OTHER"),
      sizeMl: toInt(formData.get("sizeMl") as string, 700),
      abv: toFloat(formData.get("abv") as string, 40),
      bottlesPerCase: toInt(formData.get("bottlesPerCase") as string, 6),
      casesPerPallet: toInt(formData.get("casesPerPallet") as string, 140),
      laborPerBottleCents: toCents(formData.get("laborPerBottle") as string),
      caseCostCents: toCents(formData.get("caseCost") as string),
      exWorksCents: toCents(formData.get("exWorks") as string),
    },
  });
  revalidatePath("/products");
}

export async function updateProduct(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  // Products with a BOM derive COGS automatically — manual input only applies without one.
  const hasBom = (await db.bomItem.count({ where: { productId: id } })) > 0;
  await db.product.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? "").trim(),
      laborPerBottleCents: toCents(formData.get("laborPerBottle") as string),
      ...(hasBom ? {} : { caseCostCents: toCents(formData.get("caseCost") as string) }),
      exWorksCents: toCents(formData.get("exWorks") as string),
      active: formData.get("active") === "on",
    },
  });
  if (hasBom) await recalcProductCosts([id]);
  revalidatePath("/products");
}

export async function addBomItem(formData: FormData) {
  await requireOps();
  const productId = String(formData.get("productId"));
  const componentId = String(formData.get("componentId"));
  const qty = toFloat(formData.get("qty") as string, 1);
  if (!componentId || qty <= 0) return;
  await db.bomItem.upsert({
    where: { productId_componentId: { productId, componentId } },
    create: { productId, componentId, qty, per: String(formData.get("per") ?? "BOTTLE") },
    update: { qty, per: String(formData.get("per") ?? "BOTTLE") },
  });
  await recalcProductCosts([productId]);
  revalidatePath("/products");
}

export async function removeBomItem(formData: FormData) {
  await requireOps();
  const item = await db.bomItem.delete({ where: { id: String(formData.get("id")) } });
  await recalcProductCosts([item.productId]);
  revalidatePath("/products");
}
