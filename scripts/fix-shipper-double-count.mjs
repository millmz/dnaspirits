/**
 * One-time correction for double-counted shipper boxes.
 *
 * Box quantities were entered manually on Dry Goods first, and PO
 * RX2-20260710 was then received into stock — counting the same boxes twice.
 * The received invoice is the source of truth, so this removes every manual
 * ADJUSTMENT movement on the five shipper-box components, leaving PO receipts
 * (and any production consumption) as the only stock history.
 *
 * Strictly one-time: it only runs when the PO is RECEIVED and not yet marked
 * fixed, and it stamps a marker on the PO afterwards — future manual
 * adjustments (breakage, count corrections) are never touched again.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const PO_NUMBER = "RX2-20260710";
const MARKER = "[shipper-count-fixed]";
const BOX_NAMES = [
  "Shipper Box — Blanco 700ml",
  "Shipper Box — Reposado 700ml",
  "Shipper Box — Añejo 700ml",
  "Shipper Box — Blanco 1L",
  "Shipper Box — Reposado 1L",
];

async function main() {
  const po = await db.purchaseOrder.findUnique({ where: { poNumber: PO_NUMBER } });
  if (!po) {
    console.log("fix-shipper-count: PO not found — nothing to do.");
    return;
  }
  if (po.notes.includes(MARKER)) {
    console.log("fix-shipper-count: already applied — skipping.");
    return;
  }
  if (po.status !== "RECEIVED") {
    console.log("fix-shipper-count: PO not received yet — skipping (will fix once received).");
    return;
  }

  const boxes = await db.component.findMany({ where: { name: { in: BOX_NAMES } } });
  for (const box of boxes) {
    const manual = await db.componentMovement.findMany({
      where: { componentId: box.id, type: "ADJUSTMENT" },
    });
    if (manual.length === 0) continue;
    await db.componentMovement.deleteMany({
      where: { id: { in: manual.map((m) => m.id) } },
    });
    for (const m of manual) {
      console.log(
        `fix-shipper-count: removed manual entry on ${box.name}: ${m.qty > 0 ? "+" : ""}${m.qty} (${m.date.toISOString().slice(0, 10)}${m.notes ? `, "${m.notes}"` : ""})`
      );
    }
    const onHand = await db.componentMovement.aggregate({
      where: { componentId: box.id },
      _sum: { qty: true },
    });
    console.log(`fix-shipper-count: ${box.name} now at ${onHand._sum.qty ?? 0} boxes.`);
  }

  await db.purchaseOrder.update({
    where: { id: po.id },
    data: { notes: `${po.notes} ${MARKER}`.trim() },
  });
  console.log("fix-shipper-count: done — counts now match the received invoice.");
}

main()
  .catch((e) => {
    console.error("fix-shipper-count: skipped due to error:", e);
  })
  .finally(() => db.$disconnect());
