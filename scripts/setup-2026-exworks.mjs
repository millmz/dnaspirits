/**
 * Loads the 2026 ex-works sales to LSI from the executed invoices (the PDFs
 * remain the documents of record). Reviewed against the source invoices with
 * Adam on 2026-07-29; two discrepancies were resolved by him directly:
 *
 *  - LSI-2026-01-06-001 exists in two versions (Reposado 550 vs 96). LSI took
 *    96 due to a miscommunication — the 96-case version ($61,944) is the real
 *    January sale; the balance was bottled and shipped later.
 *  - INV-2026-001 (Blanco glass @ $114.36) carries a note saying it
 *    supersedes the $102 invoice, but Adam confirmed (2026-07-29) that
 *    INV-20260415-001 (aluminum @ $102) and INV-2026-001 (glass @ $114.36)
 *    are BOTH real, separate sales — both load.
 *
 * Each invoice's lines are verified against its printed total before loading,
 * and an invoice only loads if its number isn't already in the ledger — so
 * manual edits in the app afterwards are never overwritten.
 *
 * Deliberately NO inventory movements: this is a revenue backfill; the cases
 * shipped from production that predates the movement ledger. All five
 * invoices were settled by LSI net of chargebacks (per Adam, 2026-07-29), so
 * they load as PAID — revenue stays gross, chargebacks net against it as
 * trade spend, which is the platform's model. Exact settlement dates weren't
 * on file, so paidDate approximates as the NET-30 due date.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const usd = (d) => Math.round(d * 100);

// [invoiceNumber, date, printed total, lines: [sku, cases, $/case]]
const INVOICES = [
  {
    invoiceNumber: "LSI-2026-01-06-001",
    date: "2026-01-06",
    totalUsd: 61944.0,
    notes:
      "Backfilled from the executed invoice. LSI took 96 Reposado (not the 550 on the first draft) — balance shipped later.",
    lines: [
      ["DN-BLANCO-700", 500, 102.0],
      ["DN-REPO-700", 96, 114.0],
    ],
  },
  {
    invoiceNumber: "INV-20260331-001",
    date: "2026-03-31",
    totalUsd: 57000.0,
    notes: "Backfilled from the executed invoice.",
    lines: [["DN-REPO-700", 500, 114.0]],
  },
  {
    invoiceNumber: "INV-2026-001",
    date: "2026-04-01",
    totalUsd: 57180.0,
    notes:
      "Backfilled from the executed invoice (ref PO O001200). Blanco glass @ $114.36 — a separate sale from the aluminum INV-20260415-001, per Adam despite the invoice's supersession note.",
    lines: [["DN-BLANCO-700", 500, 114.36]],
  },
  {
    invoiceNumber: "INV-20260415-001",
    date: "2026-04-15",
    totalUsd: 51000.0,
    notes:
      "Backfilled from the executed invoice. Blanco 700ml aluminum-bottle cases @ $102 — confirmed a real sale alongside the glass INV-2026-001.",
    lines: [["DN-BLANCO-700", 500, 102.0]],
  },
  {
    invoiceNumber: "INV-2026-002",
    date: "2026-06-02",
    totalUsd: 183231.36,
    notes: "Backfilled from the executed invoice (ref PO O001200).",
    lines: [
      ["DN-ANEJO-700", 192, 166.62],
      ["DN-BLANCO-700", 192, 114.36],
      ["DN-REPO-700", 192, 124.8],
      ["DN-BLANCO-1L", 480, 141.42],
      ["DN-REPO-1L", 240, 156.0],
    ],
  },
];

async function main() {
  const importer = await db.importer.findFirst({ where: { name: { contains: "Luxury" } } })
    ?? await db.importer.findFirst({ where: { name: { contains: "LSI" } } })
    ?? await db.importer.findFirst();
  const warehouse = await db.warehouse.findFirst({ where: { name: { contains: "NOM" } } })
    ?? await db.warehouse.findFirst();
  if (!importer || !warehouse) {
    console.log("2026-exworks: importer/warehouse not set up yet — skipping (will retry next boot).");
    return;
  }

  const products = await db.product.findMany();
  const bySku = new Map(products.map((p) => [p.sku, p]));

  for (const inv of INVOICES) {
    // lines must reproduce the invoice's printed total to the cent
    const computedCents = inv.lines.reduce((a, [, cases, price]) => a + cases * usd(price), 0);
    if (computedCents !== usd(inv.totalUsd)) {
      console.error(
        `2026-exworks: ${inv.invoiceNumber} lines compute to $${(computedCents / 100).toFixed(2)}, invoice says $${inv.totalUsd.toFixed(2)} — skipping.`
      );
      continue;
    }
    const missing = inv.lines.filter(([sku]) => !bySku.has(sku));
    if (missing.length > 0) {
      console.error(`2026-exworks: ${inv.invoiceNumber} — unknown SKU(s) ${missing.map(([s]) => s).join(", ")} — skipping.`);
      continue;
    }
    const existing = await db.exWorksSale.findFirst({ where: { invoiceNumber: inv.invoiceNumber } });
    if (existing) {
      // an earlier version of this backfill loaded UNPAID — settle it, but
      // only if the row is still untouched (no payments recorded manually)
      if (
        existing.invoiceStatus === "UNPAID" &&
        existing.amountPaidCents === 0 &&
        existing.notes.startsWith("Backfilled")
      ) {
        await db.exWorksSale.update({
          where: { id: existing.id },
          data: { invoiceStatus: "PAID", paidDate: existing.dueDate ?? existing.date },
        });
        console.log(`2026-exworks: ${inv.invoiceNumber} already in the ledger — marked PAID (settled net of chargebacks).`);
      } else {
        console.log(`2026-exworks: ${inv.invoiceNumber} already in the ledger — skipping.`);
      }
      continue;
    }

    const date = new Date(`${inv.date}T12:00:00Z`);
    const due = new Date(date.getTime() + 30 * 86400_000); // NET 30
    await db.exWorksSale.create({
      data: {
        importerId: importer.id,
        warehouseId: warehouse.id,
        date,
        dueDate: due,
        status: "CONFIRMED",
        invoiceNumber: inv.invoiceNumber,
        invoiceStatus: "PAID",
        paidDate: due, // settled net of chargebacks; exact date approximated as NET-30
        notes: `${inv.notes} Settled by LSI net of chargebacks.`,
        lines: {
          create: inv.lines.map(([sku, cases, price]) => ({
            productId: bySku.get(sku).id,
            cases,
            pricePerCaseCents: usd(price),
          })),
        },
      },
    });
    console.log(`2026-exworks: loaded ${inv.invoiceNumber} — $${inv.totalUsd.toFixed(2)} (${inv.lines.length} line${inv.lines.length === 1 ? "" : "s"}).`);
  }

  // An earlier revision of this backfill booked a $7,254.68 settlement
  // chargeback derived from a since-corrected figure — remove it if it's
  // still sitting there untouched.
  const stale = await db.chargeback.findFirst({
    where: { reference: "2026-SETTLEMENT-NET", saleId: null, amountCents: usd(7254.68) },
  });
  if (stale) {
    await db.chargeback.delete({ where: { id: stale.id } });
    console.log("2026-exworks: removed the superseded $7,254.68 settlement chargeback.");
  }

  const gross = INVOICES.reduce((a, i) => a + i.totalUsd, 0);
  console.log(`2026-exworks: done — 2026 ex-works revenue $${gross.toFixed(2)} across ${INVOICES.length} invoices.`);
}

main()
  .catch((e) => {
    console.error("2026-exworks failed:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
