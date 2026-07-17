"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toCents, toInt, toDate } from "@/lib/format";
import { bomRequirements, getComponentStock } from "@/lib/inventory";

export async function createRun(formData: FormData) {
  await requireOps();
  const lotCode = String(formData.get("lotCode") ?? "").trim().toUpperCase();
  if (await db.productionRun.findUnique({ where: { lotCode } })) {
    redirect(`/production?err=${encodeURIComponent(`Lot code ${lotCode} already exists — pick another.`)}`);
  }
  await db.productionRun.create({
    data: {
      lotCode,
      productId: String(formData.get("productId")),
      warehouseId: String(formData.get("warehouseId")),
      startDate: toDate(formData.get("startDate") as string),
      bottlesPlanned: toInt(formData.get("bottlesPlanned") as string),
      agaveSource: String(formData.get("agaveSource") ?? "").trim(),
      distillery: String(formData.get("distillery") ?? "").trim(),
      totalCostCents: toCents(formData.get("totalCost") as string),
      notes: String(formData.get("notes") ?? "").trim(),
      status: "PLANNED",
    },
  });
  revalidatePath("/production");
}

export async function startRun(formData: FormData) {
  await requireOps();
  await db.productionRun.update({
    where: { id: String(formData.get("id")) },
    data: { status: "IN_PROGRESS" },
  });
  revalidatePath("/production");
}

/**
 * Completing a run:
 *  - posts finished bottles into the destination warehouse
 *  - consumes dry goods per the product's BOM
 * Refuses (with an error banner) if any component would go negative.
 */
export async function completeRun(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const bottlesProduced = toInt(formData.get("bottlesProduced") as string);
  const totalCostCents = toCents(formData.get("totalCost") as string);
  const bottledDate = toDate(formData.get("bottledDate") as string);

  const run = await db.productionRun.findUniqueOrThrow({
    where: { id },
    include: { product: true },
  });
  if (run.status === "COMPLETED") return;

  // Snapshot the cost at completion: today's BOM-derived COGS × bottles.
  // Later component-price or packaging changes never rewrite this run.
  const autoCostCents = Math.round(
    (run.product.caseCostCents / run.product.bottlesPerCase) * bottlesProduced
  );

  const reqs = await bomRequirements(run.productId, bottlesProduced);
  const stock = await getComponentStock();
  const short = reqs.filter((r) => (stock.get(r.componentId) ?? 0) < r.needed);
  if (short.length > 0) {
    const msg = short
      .map((s) => `${s.name}: need ${Math.ceil(s.needed)}, have ${Math.floor(stock.get(s.componentId) ?? 0)}`)
      .join("; ");
    redirect(`/production?err=${encodeURIComponent(`Not enough dry goods — ${msg}`)}`);
  }

  await db.$transaction([
    db.productionRun.update({
      where: { id },
      data: {
        status: "COMPLETED",
        bottlesProduced,
        bottledDate,
        totalCostCents: totalCostCents > 0 ? totalCostCents : autoCostCents,
      },
    }),
    db.inventoryMovement.create({
      data: {
        productId: run.productId,
        warehouseId: run.warehouseId,
        productionRunId: id,
        type: "PRODUCTION",
        bottles: bottlesProduced,
        date: bottledDate,
        notes: `Lot ${run.lotCode} bottled`,
      },
    }),
    ...reqs.map((r) =>
      db.componentMovement.create({
        data: {
          componentId: r.componentId,
          type: "PRODUCTION",
          qty: -r.needed,
          date: bottledDate,
          reference: run.lotCode,
          notes: `Consumed by lot ${run.lotCode}`,
        },
      })
    ),
  ]);
  revalidatePath("/production");
  revalidatePath("/inventory");
  revalidatePath("/components");
  revalidatePath("/");
}

/** Remove a run that hasn't produced anything yet. */
export async function deleteRun(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const run = await db.productionRun.findUnique({ where: { id } });
  if (!run || run.status === "COMPLETED") return;
  await db.productionRun.delete({ where: { id } });
  revalidatePath("/production");
}

/**
 * Undo a mistaken completion: removes the finished-goods posting and returns
 * the consumed dry goods. Refuses if the bottled stock has since been sold or
 * transferred (reversal would drive the warehouse negative).
 */
export async function uncompleteRun(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const run = await db.productionRun.findUniqueOrThrow({ where: { id } });
  if (run.status !== "COMPLETED") return;

  const { getStockForWarehouse } = await import("@/lib/inventory");
  const onHand = await getStockForWarehouse(run.productId, run.warehouseId);
  if (onHand < run.bottlesProduced) {
    redirect(
      `/production?err=${encodeURIComponent(
        `Can't undo lot ${run.lotCode} — only ${onHand} of its ${run.bottlesProduced} bottles are still in the warehouse.`
      )}`
    );
  }

  await db.$transaction([
    db.inventoryMovement.deleteMany({ where: { productionRunId: id, type: "PRODUCTION" } }),
    db.componentMovement.deleteMany({ where: { type: "PRODUCTION", reference: run.lotCode } }),
    db.productionRun.update({
      where: { id },
      data: { status: "IN_PROGRESS", bottlesProduced: 0, bottledDate: null },
    }),
  ]);
  revalidatePath("/production");
  revalidatePath("/inventory");
  revalidatePath("/components");
  revalidatePath("/");
}
