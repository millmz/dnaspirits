"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toCents, toInt, toDate } from "@/lib/format";

export async function createRun(formData: FormData) {
  await requireUser();
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
  await requireUser();
  await db.productionRun.update({
    where: { id: String(formData.get("id")) },
    data: { status: "IN_PROGRESS" },
  });
  revalidatePath("/production");
}

/**
 * Completing a run records the actual bottle count and posts a PRODUCTION
 * movement into the destination warehouse — this is what puts stock on hand.
 */
export async function completeRun(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const bottlesProduced = toInt(formData.get("bottlesProduced") as string);
  const totalCostCents = toCents(formData.get("totalCost") as string);
  const bottledDate = toDate(formData.get("bottledDate") as string);

  const run = await db.productionRun.findUniqueOrThrow({ where: { id } });
  if (run.status === "COMPLETED") return;

  await db.$transaction([
    db.productionRun.update({
      where: { id },
      data: {
        status: "COMPLETED",
        bottlesProduced,
        bottledDate,
        ...(totalCostCents > 0 ? { totalCostCents } : {}),
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
  ]);
  revalidatePath("/production");
  revalidatePath("/inventory");
  revalidatePath("/");
}
