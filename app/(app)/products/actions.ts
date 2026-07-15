"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toCents, toInt, toFloat } from "@/lib/format";

export async function createProduct(formData: FormData) {
  await requireUser();
  await db.product.create({
    data: {
      sku: String(formData.get("sku") ?? "").trim().toUpperCase(),
      name: String(formData.get("name") ?? "").trim(),
      sizeMl: toInt(formData.get("sizeMl") as string, 750),
      abv: toFloat(formData.get("abv") as string, 40),
      bottlesPerCase: toInt(formData.get("bottlesPerCase") as string, 6),
      caseCostCents: toCents(formData.get("caseCost") as string),
      casePriceCents: toCents(formData.get("casePrice") as string),
    },
  });
  revalidatePath("/products");
}

export async function updateProduct(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  await db.product.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? "").trim(),
      caseCostCents: toCents(formData.get("caseCost") as string),
      casePriceCents: toCents(formData.get("casePrice") as string),
      active: formData.get("active") === "on",
    },
  });
  revalidatePath("/products");
}
