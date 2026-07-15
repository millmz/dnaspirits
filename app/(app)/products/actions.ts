"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toCents, toInt, toFloat } from "@/lib/format";

export async function createProduct(formData: FormData) {
  await requireOps();
  await db.product.create({
    data: {
      sku: String(formData.get("sku") ?? "").trim().toUpperCase(),
      name: String(formData.get("name") ?? "").trim(),
      tier: String(formData.get("tier") ?? "OTHER"),
      sizeMl: toInt(formData.get("sizeMl") as string, 750),
      abv: toFloat(formData.get("abv") as string, 40),
      bottlesPerCase: toInt(formData.get("bottlesPerCase") as string, 6),
      caseCostCents: toCents(formData.get("caseCost") as string),
      exWorksCents: toCents(formData.get("exWorks") as string),
    },
  });
  revalidatePath("/products");
}

export async function updateProduct(formData: FormData) {
  await requireOps();
  await db.product.update({
    where: { id: String(formData.get("id")) },
    data: {
      name: String(formData.get("name") ?? "").trim(),
      caseCostCents: toCents(formData.get("caseCost") as string),
      exWorksCents: toCents(formData.get("exWorks") as string),
      active: formData.get("active") === "on",
    },
  });
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
  revalidatePath("/products");
}

export async function removeBomItem(formData: FormData) {
  await requireOps();
  await db.bomItem.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/products");
}
