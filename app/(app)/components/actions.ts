"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toCents, toFloat, toInt, toDate } from "@/lib/format";
import { recalcProductsUsingComponents } from "@/lib/bom-cost";
import { getComponentStock } from "@/lib/inventory";

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

/** Inline edit of cost/reorder/lead-time. A blank cost keeps the current one. */
export async function updateComponent(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const costRaw = String(formData.get("unitCost") ?? "").trim();
  await db.component.update({
    where: { id },
    data: {
      ...(costRaw ? { unitCostCents: toCents(costRaw) } : {}),
      reorderPoint: toFloat(formData.get("reorderPoint") as string),
      leadTimeDays: toInt(formData.get("leadTimeDays") as string, 30),
    },
  });
  if (costRaw) await recalcProductsUsingComponents([id]);
  revalidatePath("/components");
  revalidatePath("/products");
  revalidatePath("/");
}

/** Full edit: name, category, unit, supplier, notes (details form). */
export async function editComponentDetails(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/components?err=Component+name+can%27t+be+empty");
  const supplierId = String(formData.get("supplierId") ?? "");
  await db.component.update({
    where: { id },
    data: {
      name,
      category: String(formData.get("category") ?? "OTHER"),
      unit: String(formData.get("unit") ?? "pcs"),
      supplierId: supplierId || null,
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/components");
  redirect("/components");
}

/** Retire a discontinued dry good (or bring it back). History is kept. */
export async function toggleComponentActive(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const c = await db.component.findUniqueOrThrow({ where: { id } });
  await db.component.update({ where: { id }, data: { active: !c.active } });
  revalidatePath("/components");
}

export async function adjustComponent(formData: FormData) {
  await requireOps();
  const qty = toFloat(formData.get("qty") as string);
  const componentId = String(formData.get("componentId"));
  if (qty === 0) redirect("/components?err=Enter+a+non-zero+adjustment+quantity");

  if (qty < 0) {
    const stock = await getComponentStock();
    const onHand = stock.get(componentId) ?? 0;
    if (onHand + qty < 0) {
      redirect(
        `/components?err=${encodeURIComponent(
          `That adjustment would take stock below zero (on hand: ${Math.floor(onHand)}).`
        )}`
      );
    }
  }

  await db.componentMovement.create({
    data: {
      componentId,
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

export async function updateSupplier(formData: FormData) {
  await requireOps();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/components?err=Supplier+name+can%27t+be+empty");
  await db.supplier.update({
    where: { id: String(formData.get("id")) },
    data: {
      name,
      location: String(formData.get("location") ?? "").trim(),
      contactName: String(formData.get("contactName") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
    },
  });
  revalidatePath("/components");
  revalidatePath("/purchasing");
  redirect("/components");
}
