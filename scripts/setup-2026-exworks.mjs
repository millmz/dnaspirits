/**
 * Loads the 2026 ex-works sales to LSI from the executed invoices, and the
 * importer credits settled against them, reconciled to LSI's own records
 * (remittance advices, FISPAN payment notice, credit memo PCM000470 and the
 * SEP26 clawback workbook) on 2026-11-11.
 *
 * Revenue model (Adam's instruction to the bookkeeper, 2025-01 → 2026-01):
 * as with MHW, revenue is recorded GROSS — cases shipped × ex-works price —
 * even when LSI keeps part of it to offset billbacks. Billbacks / clawbacks
 * are recorded separately as trade spend (Chargeback rows), dated to the
 * period they relate to.
 *
 * The five 2026 invoices, all physically shipped:
 *  - LSI-2026-01-06-001  PO O001027 (placed Dec 2025) — 500 Blanco + 96 Repo,
 *    shipped January. The 96 is what LSI took after a miscommunication.
 *  - INV-20260331-001    PO O001111 — 500 Reposado (picked up 3/20). The
 *    Blanco on the original O001111 did NOT ship; it was held at the
 *    distillery and rebottled into glass.
 *  - INV-20260415-001    PO O001190 — 500 Blanco aluminum (picked up 4/15).
 *  - INV-2026-001        PO O001200 — the rebottled 500 Blanco, now glass,
 *    at the glass ex-works price $114.36. Shipped with the June PO, received
 *    and invoiced 8/21. Supersedes a $102 draft that was never paid.
 *  - INV-2026-002        PO O001200 — reissued 8/21 with Añejo at $185.94
 *    (was $166.62 on the June draft).
 *
 * Settlement: LSI paid the first three on 2026-05-18 ($111,689.32) NET of the
 * "2025 Debit Note" (−$58,254.68, 2025 margin recovery + marketing
 * chargebacks) and initiated ACH for the last two on 2026-10-12
 * ($244,120.80, no credits). The 2025 debit note is 2025 trade spend that
 * happened to be settled out of 2026 receivables — it does not reduce 2026
 * revenue.
 *
 * Safe re-runs: an invoice already in the ledger is only rewritten while it
 * still carries this backfill's "Backfilled" note (i.e. nobody edited it in
 * the app); chargebacks are only added when their reference isn't on file
 * and no chargebacks already exist for that period.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const usd = (d) => Math.round(d * 100);
const day = (s) => new Date(`${s}T12:00:00Z`);

// [invoiceNumber, invoice date, paid date, printed total, lines: [sku, cases, $/case]]
const INVOICES = [
  {
    invoiceNumber: "LSI-2026-01-06-001",
    date: "2026-01-06",
    paidDate: "2026-05-18",
    totalUsd: 61944.0,
    notes:
      "Backfilled from the executed invoice (PO O001027, placed Dec 2025, shipped Jan 2026). LSI took 96 Reposado (not the 550 on the first draft).",
    lines: [
      ["DN-BLANCO-700", 500, 102.0],
      ["DN-REPO-700", 96, 114.0],
    ],
  },
  {
    invoiceNumber: "INV-20260331-001",
    date: "2026-03-31",
    paidDate: "2026-05-18",
    totalUsd: 57000.0,
    notes: "Backfilled from the executed invoice (PO O001111 — 500 Reposado, picked up 3/20).",
    lines: [["DN-REPO-700", 500, 114.0]],
  },
  {
    invoiceNumber: "INV-20260415-001",
    date: "2026-04-15",
    paidDate: "2026-05-18",
    totalUsd: 51000.0,
    notes: "Backfilled from the executed invoice (PO O001190 — 500 Blanco aluminum, picked up 4/15).",
    lines: [["DN-BLANCO-700", 500, 102.0]],
  },
  {
    invoiceNumber: "INV-2026-001",
    date: "2026-08-21",
    paidDate: "2026-10-12",
    totalUsd: 57180.0,
    notes:
      "Backfilled from the executed invoice (PO O001200). The 500 Blanco held back from O001111, rebottled into glass and shipped with the June PO at the glass price $114.36; received/invoiced 8/21. Supersedes an unpaid $102 draft.",
    lines: [["DN-BLANCO-700", 500, 114.36]],
  },
  {
    invoiceNumber: "INV-2026-002",
    date: "2026-08-21",
    paidDate: "2026-10-12",
    totalUsd: 186940.8,
    notes:
      "Backfilled from the reissued invoice dated 8/21 (PO O001200, June order). Añejo FOB $185.94 (June draft had $166.62).",
    lines: [
      ["DN-ANEJO-700", 192, 185.94],
      ["DN-BLANCO-700", 192, 114.36],
      ["DN-REPO-700", 192, 124.8],
      ["DN-BLANCO-1L", 480, 141.42],
      ["DN-REPO-1L", 240, 156.0],
    ],
  },
];

const SETTLED_NOTE = {
  "2026-05-18": "Paid 5/18/2026 by LSI ($111,689.32 remittance, net of the 2025 debit note).",
  "2026-10-12": "Paid by LSI ACH initiated 10/12/2026 ($244,120.80, no credits).",
};

// Importer credits, by the month they relate to. Amounts are what LSI bills
// De Nada (positive = cost to De Nada).
// [reference, date, category, amount, note]
const MARGIN = "OTHER"; // contractual margin clawback — LSI's guaranteed margin true-up
const CD = "DISTRIBUTOR_PROMO"; // customer discounts / depletion allowances
const AP = "MARKETING"; // A&P
const CHARGEBACK_GROUPS = [
  {
    reference: "2025 DEBIT NOTE",
    period: ["2025-01-01", "2025-12-31"],
    applyTo: "LSI-2026-01-06-001", // netted from the 5/18/2026 remittance
    rows: [
      [
        "2025-12-31",
        MARGIN,
        58254.68,
        "LSI 2025 Debit Note — contractual margin recovery and marketing chargebacks for 2025, netted from the 5/18/2026 remittance. 2025 trade spend; does not reduce 2026 revenue.",
      ],
    ],
  },
  {
    reference: "PCM000470",
    period: ["2026-01-01", "2026-06-30"],
    applyTo: null, // open — LSI asked for payment 10/28/2026
    rows: [
      ["2026-01-31", MARGIN, 5858.98, "Jan margin clawback"],
      ["2026-01-31", CD, 42.0, "Jan customer discounts"],
      ["2026-01-31", AP, 2997.81, "Jan A&P"],
      ["2026-02-28", MARGIN, 9050.82, "Feb margin clawback"],
      ["2026-02-28", CD, 8259.15, "Feb customer discounts"],
      ["2026-02-28", AP, 5683.98, "Feb A&P"],
      ["2026-03-31", MARGIN, 6952.33, "Mar margin clawback"],
      ["2026-03-31", CD, 6043.95, "Mar customer discounts"],
      ["2026-03-31", AP, 2838.96, "Mar A&P"],
      ["2026-04-30", MARGIN, 9622.9, "Apr margin clawback"],
      ["2026-04-30", CD, 2255.34, "Apr customer discounts"],
      ["2026-04-30", AP, 7249.78, "Apr A&P"],
      ["2026-05-31", MARGIN, 15189.88, "May margin clawback"],
      ["2026-05-31", CD, 6477.71, "May customer discounts"],
      ["2026-05-31", AP, 11090.06, "May A&P"],
      ["2026-06-30", MARGIN, -3247.08, "Jun margin clawback (credit to De Nada)"],
      ["2026-06-30", CD, 4635.02, "Jun customer discounts"],
      ["2026-06-30", AP, 12937.24, "Jun A&P"],
    ],
    note: "LSI purchase credit memo PCM000470 (9/29/2026), H1-26 clawbacks — approved 9/16/2026, still open (LSI requested payment 10/28/2026).",
    expectTotal: 113938.83,
  },
  {
    reference: "LSI SEP26 CLAWBACKS",
    period: ["2026-07-01", "2026-09-30"],
    applyTo: null,
    rows: [
      ["2026-07-31", MARGIN, 4281.91, "Jul margin clawback"],
      ["2026-07-31", CD, 7018.4, "Jul customer discounts"],
      ["2026-07-31", AP, 3540.75, "Jul A&P"],
      ["2026-08-31", MARGIN, 4489.89, "Aug margin clawback"],
      ["2026-08-31", CD, 2171.07, "Aug customer discounts"],
      ["2026-08-31", AP, 656.73, "Aug A&P"],
      ["2026-09-30", MARGIN, 19026.07, "Sep margin clawback"],
      ["2026-09-30", CD, 2751.14, "Sep customer discounts"],
      ["2026-09-30", AP, 105.47, "Sep A&P"],
    ],
    note: "Q3-26 clawbacks per LSI's SEP26 clawback workbook (10/20/2026) — accrued, not yet invoiced by LSI.",
    expectTotal: 44041.43,
  },
];

const sameLines = (existing, wanted, bySku) => {
  if (existing.length !== wanted.length) return false;
  const key = (sku, cases, cents) => `${sku}|${cases}|${cents}`;
  const have = new Set(
    existing.map((l) => key([...bySku.values()].find((p) => p.id === l.productId)?.sku, l.cases, l.pricePerCaseCents))
  );
  return wanted.every(([sku, cases, price]) => have.has(key(sku, cases, usd(price))));
};

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
  const saleIdByInvoice = new Map();

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

    const date = day(inv.date);
    const dueDate = new Date(date.getTime() + 30 * 86400_000); // NET 30
    const paidDate = day(inv.paidDate);
    const notes = `${inv.notes} ${SETTLED_NOTE[inv.paidDate]}`;
    const lineData = inv.lines.map(([sku, cases, price]) => ({
      productId: bySku.get(sku).id,
      cases,
      pricePerCaseCents: usd(price),
    }));

    const existing = await db.exWorksSale.findFirst({
      where: { invoiceNumber: inv.invoiceNumber },
      include: { lines: true },
    });
    if (existing) {
      saleIdByInvoice.set(inv.invoiceNumber, existing.id);
      if (!existing.notes.startsWith("Backfilled")) {
        console.log(`2026-exworks: ${inv.invoiceNumber} was edited in the app — leaving it alone.`);
        continue;
      }
      const upToDate =
        sameLines(existing.lines, inv.lines, bySku) &&
        existing.date.getTime() === date.getTime() &&
        existing.invoiceStatus === "PAID" &&
        existing.paidDate?.getTime() === paidDate.getTime() &&
        existing.notes === notes;
      if (upToDate) {
        console.log(`2026-exworks: ${inv.invoiceNumber} already reconciled — skipping.`);
        continue;
      }
      await db.$transaction([
        db.exWorksLine.deleteMany({ where: { saleId: existing.id } }),
        db.exWorksSale.update({
          where: { id: existing.id },
          data: {
            date,
            dueDate,
            status: "CONFIRMED",
            invoiceStatus: "PAID",
            paidDate,
            notes,
            lines: { create: lineData },
          },
        }),
      ]);
      console.log(`2026-exworks: ${inv.invoiceNumber} reconciled to LSI's records — $${inv.totalUsd.toFixed(2)}, paid ${inv.paidDate}.`);
      continue;
    }

    const sale = await db.exWorksSale.create({
      data: {
        importerId: importer.id,
        warehouseId: warehouse.id,
        date,
        dueDate,
        status: "CONFIRMED",
        invoiceNumber: inv.invoiceNumber,
        invoiceStatus: "PAID",
        paidDate,
        notes,
        lines: { create: lineData },
      },
    });
    saleIdByInvoice.set(inv.invoiceNumber, sale.id);
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

  for (const g of CHARGEBACK_GROUPS) {
    const sum = g.rows.reduce((a, [, , amt]) => a + usd(amt), 0);
    if (g.expectTotal !== undefined && sum !== usd(g.expectTotal)) {
      console.error(`2026-exworks: ${g.reference} rows total $${(sum / 100).toFixed(2)}, expected $${g.expectTotal.toFixed(2)} — skipping.`);
      continue;
    }
    if (await db.chargeback.findFirst({ where: { reference: g.reference } })) {
      console.log(`2026-exworks: ${g.reference} already on file — skipping.`);
      continue;
    }
    const inPeriod = await db.chargeback.count({
      where: { date: { gte: day(g.period[0]), lte: new Date(`${g.period[1]}T23:59:59Z`) } },
    });
    if (inPeriod > 0) {
      console.log(
        `2026-exworks: ${inPeriod} chargeback(s) already recorded for ${g.period[0]}–${g.period[1]} — not adding ${g.reference} (would double count).`
      );
      continue;
    }
    const saleId = g.applyTo ? saleIdByInvoice.get(g.applyTo) ?? null : null;
    await db.chargeback.createMany({
      data: g.rows.map(([date, category, amt, note]) => ({
        importerId: importer.id,
        saleId,
        date: day(date),
        category,
        amountCents: usd(amt),
        reference: g.reference,
        notes: g.note ? `${note}. ${g.note}` : note,
      })),
    });
    console.log(`2026-exworks: booked ${g.reference} — $${(sum / 100).toFixed(2)} across ${g.rows.length} row(s).`);
  }

  const gross = INVOICES.reduce((a, i) => a + usd(i.totalUsd), 0);
  console.log(`2026-exworks: done — 2026 ex-works revenue $${(gross / 100).toFixed(2)} across ${INVOICES.length} invoices.`);
}

main()
  .catch((e) => {
    console.error("2026-exworks failed:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
