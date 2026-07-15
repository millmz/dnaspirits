import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

const esc = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const usd = (cents: number) => (cents / 100).toFixed(2);

/**
 * Year-end package for the accountants: one CSV with every money-relevant
 * record for the year — QB P&L lines as uploaded, ex-works invoices with
 * settlement status, LSI chargebacks itemized, and owner-logged expenses.
 * Columns: section, date/period, description, category, reference, amount.
 */
export async function GET(req: NextRequest) {
  await requireUser();
  const year = req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear());
  if (!/^\d{4}$/.test(year)) return new NextResponse("Bad year", { status: 400 });

  const start = new Date(`${year}-01-01T00:00:00Z`);
  const end = new Date(`${Number(year) + 1}-01-01T00:00:00Z`);

  const [financials, sales, chargebacks, expenses] = await Promise.all([
    db.financialEntry.findMany({
      where: { period: { startsWith: `${year}-` } },
      orderBy: [{ period: "asc" }, { account: "asc" }],
    }),
    db.exWorksSale.findMany({
      where: { status: "CONFIRMED", date: { gte: start, lt: end } },
      include: { importer: true, lines: { include: { product: true } }, chargebacks: true },
      orderBy: { date: "asc" },
    }),
    db.chargeback.findMany({
      where: { date: { gte: start, lt: end } },
      include: { importer: true, sale: true },
      orderBy: { date: "asc" },
    }),
    db.expense.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: { date: "asc" },
    }),
  ]);

  const rows: string[][] = [
    ["section", "date_or_period", "description", "category", "reference", "amount_usd"],
  ];

  for (const f of financials) {
    rows.push([
      "qb_pnl",
      f.period,
      f.account,
      f.kind.toLowerCase(),
      "",
      f.kind === "EXPENSE" ? `-${usd(f.amountCents)}` : usd(f.amountCents),
    ]);
  }

  for (const s of sales) {
    const total = s.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
    const credits = s.chargebacks.reduce((a, c) => a + c.amountCents, 0);
    const cases = s.lines.reduce((a, l) => a + l.cases, 0);
    rows.push([
      "exworks_invoice",
      s.date.toISOString().slice(0, 10),
      `${s.importer.name} — ${cases} cases${s.invoiceStatus === "PAID" ? " (paid)" : " (open)"}${credits > 0 ? ` — ${usd(credits)} settled via chargebacks` : ""}`,
      "revenue",
      s.invoiceNumber,
      usd(total),
    ]);
  }

  for (const c of chargebacks) {
    rows.push([
      "lsi_chargeback",
      c.date.toISOString().slice(0, 10),
      `${c.importer.name}${c.sale ? ` — applied to ${c.sale.invoiceNumber || "invoice"}` : " — unapplied"}${c.notes ? ` — ${c.notes}` : ""}`,
      c.category.toLowerCase(),
      c.reference,
      `-${usd(c.amountCents)}`,
    ]);
  }

  for (const e of expenses) {
    rows.push([
      "logged_expense",
      e.date.toISOString().slice(0, 10),
      `${e.vendor}${e.notes ? ` — ${e.notes}` : ""}`,
      e.category.toLowerCase(),
      "",
      `-${usd(e.amountCents)}`,
    ]);
  }

  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="denada-year-end-${year}.csv"`,
    },
  });
}
