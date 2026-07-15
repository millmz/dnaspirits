"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toCents, toFloat, toInt, toDate } from "@/lib/format";
import { recalcProductsUsingComponents } from "@/lib/bom-cost";

export async function createComponent(formData: FormData) {
  await requireOps();
  const supplierId = String(formData.get("supplierId") ?? "");
  await db.component.create({
    data: {
      name: String(formData.get("name") ?? "").trim(),
      category: String(formData.get("category") ?? "OTHER"),
      unit: String(formData.get("unit") ?? "pcs"),
      supplierId: supplierId || null,
      unitCostCents: toCents(formData.get("unitCost") as string),
      leadTimeDays: toInt(formData.get("leadTimeDays") as string, 30),
      reorderPoint: toFloat(formData.get("reorderPoint") as string),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/components");
}

/** Edit a component's cost/reorder settings; cost changes flow into product COGS via the BOMs. */
export async function updateComponent(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  await db.component.update({
    where: { id },
    data: {
      unitCostCents: toCents(formData.get("unitCost") as string),
      reorderPoint: toFloat(formData.get("reorderPoint") as string),
      leadTimeDays: toInt(formData.get("leadTimeDays") as string, 30),
    },
  });
  await recalcProductsUsingComponents([id]);
  revalidatePath("/components");
  revalidatePath("/products");
  revalidatePath("/");
}

export async function adjustComponent(formData: FormData) {
  await requireOps();
  const qty = toFloat(formData.get("qty") as string);
  if (qty === 0) return;
  await db.componentMovement.create({
    data: {
      componentId: String(formData.get("componentId")),
      type: "ADJUSTMENT",
      qty,
      date: toDate(formData.get("date") as string),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/components");
  revalidatePath("/");
}

export async function createSupplier(formData: FormData) {
  await requireOps();
  await db.supplier.create({
    data: {
      name: String(formData.get("name") ?? "").trim(),
      location: String(formData.get("location") ?? "").trim(),
      contactName: String(formData.get("contactName") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
    },
  });
  revalidatePath("/components");
  revalidatePath("/purchasing");
}
