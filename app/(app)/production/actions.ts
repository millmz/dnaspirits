"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toCents, toInt, toDate } from "@/lib/format";
import { bomRequirements, getComponentStock } from "@/lib/inventory";

export async function createRun(formData: FormData) {
  await requireOps();
  await db.productionRun.create({
    data: {
      lotCode: String(formData.get("lotCode") ?? "").trim().toUpperCase(),
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
