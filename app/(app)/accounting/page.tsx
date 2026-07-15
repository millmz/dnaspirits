import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, dateStr, num } from "@/lib/format";
import { PageHeader, Card, Stat, Table, Td, Badge, Field, inputCls, btnCls, EmptyState, Callout } from "@/components/ui";
import { getOpenReceivables } from "@/lib/receivables";
import { createExpense, deleteExpense, importFinancials } from "./actions";

const CB_LABELS: Record<string, string> = {
  DISTRIBUTOR_PROMO: "Distributor promo / billback",
  SAMPLES: "Samples",
  FREIGHT: "Freight",
  MARKETING: "Marketing",
  OTHER: "Other",
};

const CATEGORIES = [
  ["COGS", "COGS / Production"],
  ["DRY_GOODS", "Dry Goods"],
  ["LOGISTICS", "Logistics / Freight"],
  ["COMPLIANCE", "Compliance / Legal"],
  ["MARKETING", "Marketing"],
  ["G_AND_A", "General & Admin"],
  ["OTHER", "Other"],
] as const;

const catLabel = (key: string) => CATEGORIES.find(([k]) => k === key)?.[1] ?? key;

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ imported?: string; skipped?: string; err?: string }>;
}) {
  await requireUser();
  const { imported, skipped, err } = await searchParams;

  const year = new Date().getFullYear();
  const yearStart = new Date(`${year}-01-01`);

  const [expenses, salesYtd, receivables, financials, chargebacksYtd] = await Promise.all([
    db.expense.findMany({ orderBy: { date: "desc" }, take: 60 }),
    db.exWorksSale.findMany({
      where: { status: "CONFIRMED", date: { gte: yearStart } },
      include: { lines: { include: { product: true } } },
    }),
    getOpenReceivables(),
    db.financialEntry.findMany(),
    db.chargeback.groupBy({
      by: ["category"],
      where: { date: { gte: yearStart } },
      _sum: { amountCents: true },
    }),
  ]);

  const revenueCents = salesYtd.reduce(
    (a, s) => a + s.lines.reduce((x, l) => x + l.cases * l.pricePerCaseCents, 0),
    0
  );
  const cogsCents = salesYtd.reduce(
    (a, s) => a + s.lines.reduce((x, l) => x + l.cases * l.product.caseCostCents, 0),
    0
  );
  const receivablesCents = receivables.totalNetCents;
  const chargebacksTotalYtd = chargebacksYtd.reduce((a, c) => a + (c._sum.amountCents ?? 0), 0);

  // QuickBooks view: net by period
  const qbByPeriod = new Map<string, { income: number; expense: number }>();
  for (const f of financials) {
    const cur = qbByPeriod.get(f.period) ?? { income: 0, expense: 0 };
    if (f.kind === "INCOME") cur.income += f.amountCents;
    else cur.expense += f.amountCents;
    qbByPeriod.set(f.period, cur);
  }
  const qbPeriods = [...qbByPeriod.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);

  const expensesYtd = await db.expense.groupBy({
    by: ["category"],
    where: { date: { gte: yearStart } },
    _sum: { amountCents: true },
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        label="Finance"
        title="Accounting"
        subtitle="Operating numbers in real time. QuickBooks stays the ledger of record — your bookkeeper uploads the monthly P&L here so the books sit next to the operations."
      />

      {imported !== undefined && (
        <Callout tone="green">
          Imported {imported} P&amp;L line{imported === "1" ? "" : "s"} from QuickBooks export.
          {skipped && <div className="mt-1 text-burnt">Skipped rows: {skipped}</div>}
        </Callout>
      )}
      {err && <Callout tone="red">{err}</Callout>}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Ex-works revenue · YTD" value={money(revenueCents)} tone="agave" hint="Confirmed sales to importer" />
        <Stat label="COGS · YTD" value={money(cogsCents)} hint="From product case costs" />
        <Stat
          label="Open receivables"
          value={money(receivablesCents)}
          tone={receivablesCents > 0 ? "reposado" : "ink"}
          hint={`${receivables.items.length} unpaid invoice${receivables.items.length === 1 ? "" : "s"}, net of ${money(chargebacksTotalYtd)} YTD chargebacks`}
        />
        <Stat
          label="Gross margin · YTD"
          value={revenueCents > 0 ? `${Math.round(((revenueCents - cogsCents) / revenueCents) * 100)}%` : "—"}
          hint="Revenue − COGS, ex-works basis"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Open receivables">
            {receivables.items.length === 0 ? (
              <EmptyState>No unpaid invoices.</EmptyState>
            ) : (
              <Table
                headers={["Date", "Importer", "Invoice", "Amount", "Credits", "Net due"]}
                align={["left", "left", "left", "right", "right", "right"]}
              >
                {receivables.items.map((s) => (
                  <tr key={s.saleId}>
                    <Td>{dateStr(s.date)}</Td>
                    <Td>{s.importerName}</Td>
                    <Td>{s.invoiceNumber || "—"}</Td>
                    <Td right>{money(s.totalCents)}</Td>
                    <Td right className={s.creditsCents > 0 ? "text-burnt" : ""}>
                      {s.creditsCents > 0 ? `−${money(s.creditsCents)}` : "—"}
                    </Td>
                    <Td right className="font-medium">{money(s.netDueCents)}</Td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="mt-3 text-xs text-slate/70">
              Credits are LSI chargebacks applied against invoices — record them on the Ex-Works Sales page.
            </p>
          </Card>

          <Card title={`LSI chargebacks · ${year} YTD`}>
            {chargebacksYtd.length === 0 ? (
              <EmptyState>No chargebacks recorded this year.</EmptyState>
            ) : (
              <Table headers={["Category", "Amount"]} align={["left", "right"]}>
                {chargebacksYtd
                  .sort((a, b) => (b._sum.amountCents ?? 0) - (a._sum.amountCents ?? 0))
                  .map((c) => (
                    <tr key={c.category}>
                      <Td>{CB_LABELS[c.category] ?? c.category}</Td>
                      <Td right>{money(c._sum.amountCents ?? 0)}</Td>
                    </tr>
                  ))}
                <tr>
                  <Td className="font-medium">Total</Td>
                  <Td right className="font-medium">{money(chargebacksTotalYtd)}</Td>
                </tr>
              </Table>
            )}
            <p className="mt-3 text-xs text-slate/70">
              These are distribution costs settled as credits against LSI&apos;s remittances — your
              accountants receive them itemized in the year-end export below.
            </p>
          </Card>

          <Card title="QuickBooks P&L (uploaded)">
            {qbPeriods.length === 0 ? (
              <EmptyState>
                Nothing uploaded yet — your bookkeeper can upload the monthly P&amp;L export on the right.
              </EmptyState>
            ) : (
              <Table headers={["Month", "Income", "Expenses", "Net"]} align={["left", "right", "right", "right"]}>
                {qbPeriods.map(([period, v]) => (
                  <tr key={period}>
                    <Td>{period}</Td>
                    <Td right>{money(v.income)}</Td>
                    <Td right>{money(v.expense)}</Td>
                    <Td right className={v.income - v.expense < 0 ? "text-burnt" : "text-agave-deep"}>
                      {money(v.income - v.expense)}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Owner-logged expenses">
            {expenses.length === 0 ? (
              <EmptyState>No expenses logged yet.</EmptyState>
            ) : (
              <Table headers={["Date", "Vendor", "Category", "Amount", "Notes", ""]} align={["left", "left", "left", "right", "left", "left"]}>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <Td>{dateStr(e.date)}</Td>
                    <Td>{e.vendor}</Td>
                    <Td><Badge>{catLabel(e.category)}</Badge></Td>
                    <Td right>{money(e.amountCents)}</Td>
                    <Td className="text-slate">{e.notes}</Td>
                    <Td>
                      <form action={deleteExpense}>
                        <input type="hidden" name="id" value={e.id} />
                        <button className="text-xs text-slate/60 hover:text-burnt">Delete</button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Upload QuickBooks P&L">
            <form action={importFinancials} className="space-y-3">
              <Field label="P&L export (.xlsx or .csv)">
                <input name="file" type="file" accept=".xlsx,.xls,.csv,text/csv" required className={inputCls} />
              </Field>
              <button className={btnCls}>Upload</button>
              <div className="text-xs leading-relaxed text-slate/80">
                <p>
                  Upload QuickBooks&apos; <span className="font-medium">&ldquo;Profit and Loss by Month&rdquo;</span> export
                  exactly as QB produces it (Reports → Profit and Loss → columns: Months → Export to Excel).
                  One year or many years per file — historical years welcome.
                </p>
                <p className="mt-1">
                  A simple CSV with <span className="font-mono">period, account, type, amount</span> also works.
                  Re-uploading a month replaces that month&apos;s entries, so corrections and restatements are safe.
                </p>
              </div>
            </form>
          </Card>

          <Card title="Year-end package">
            <p className="text-sm leading-relaxed text-ink/85">
              One CSV with everything the accountants need for a year: QB P&amp;L lines, ex-works
              invoices with settlement status, itemized LSI chargebacks, and logged expenses.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[year, year - 1].map((y) => (
                <a
                  key={y}
                  href={`/accounting/export?year=${y}`}
                  className="rounded-md border border-agave px-3 py-1.5 text-sm font-medium text-agave-deep hover:bg-agave/10"
                >
                  Download {y}
                </a>
              ))}
            </div>
          </Card>

          <Card title="Log expense">
            <form action={createExpense} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date">
                  <input name="date" type="date" defaultValue={today} className={inputCls} />
                </Field>
                <Field label="Amount ($)">
                  <input name="amount" required placeholder="1250.00" className={inputCls} />
                </Field>
              </div>
              <Field label="Vendor">
                <input name="vendor" required placeholder="Glass supplier / freight / agency" className={inputCls} />
              </Field>
              <Field label="Category">
                <select name="category" className={inputCls}>
                  {CATEGORIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </Field>
              <Field label="Notes">
                <input name="notes" className={inputCls} />
              </Field>
              <button className={btnCls}>Log expense</button>
            </form>
          </Card>

          <Card title="YTD expenses by category">
            {expensesYtd.length === 0 ? (
              <EmptyState>Nothing logged this year.</EmptyState>
            ) : (
              <Table headers={["Category", "Total"]} align={["left", "right"]}>
                {expensesYtd
                  .sort((a, b) => (b._sum.amountCents ?? 0) - (a._sum.amountCents ?? 0))
                  .map((e) => (
                    <tr key={e.category}>
                      <Td>{catLabel(e.category)}</Td>
                      <Td right>{money(e._sum.amountCents ?? 0)}</Td>
                    </tr>
                  ))}
              </Table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
