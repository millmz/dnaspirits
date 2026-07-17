import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, dateStr, num } from "@/lib/format";
import { PageHeader, Card, Stat, Table, Td, Badge, Field, inputCls, btnCls, EmptyState, Callout } from "@/components/ui";
import { getOpenReceivables } from "@/lib/receivables";
import { qboConfigured, qboConnection } from "@/lib/qbo";
import { getCurrentUser } from "@/lib/auth";
import { createExpense, deleteExpense, importFinancials, syncQbo } from "./actions";

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
  const netRevenueCents = revenueCents - chargebacksTotalYtd; // after trade spend
  const appliedCreditsOpen = receivables.items.reduce((a, i) => a + i.creditsCents, 0);
  const paidPartial = receivables.items.reduce((a, i) => a + i.paidCents, 0);
  const anyOverCredited = receivables.items.some((i) => i.overCredited);

  const me = await getCurrentUser();
  const qboEnabled = qboConfigured();
  const qbo = qboEnabled ? await qboConnection() : null;

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
        <Stat
          label="Net revenue · YTD"
          value={money(netRevenueCents)}
          tone="agave"
          hint={`${money(revenueCents)} gross − ${money(chargebacksTotalYtd)} trade spend (chargebacks)`}
        />
        <Stat label="COGS · YTD" value={money(cogsCents)} hint="From product case costs" />
        <Stat
          label="Open receivables"
          value={money(receivablesCents)}
          tone={receivablesCents > 0 ? "reposado" : "ink"}
          hint={`${receivables.items.length} open invoice${receivables.items.length === 1 ? "" : "s"} · net of ${money(appliedCreditsOpen)} applied credits${paidPartial > 0 ? ` + ${money(paidPartial)} partial payments` : ""}`}
        />
        <Stat
          label="Net margin · YTD"
          value={netRevenueCents > 0 ? `${Math.round(((netRevenueCents - cogsCents) / netRevenueCents) * 100)}%` : "—"}
          hint="(Net revenue − COGS) ÷ net revenue — trade spend included"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Open receivables">
            {receivables.items.length === 0 ? (
              <EmptyState>No unpaid invoices.</EmptyState>
            ) : (
              <Table
                headers={["Date", "Invoice", "Age", "Amount", "Credits", "Paid", "Net due"]}
                align={["left", "left", "left", "right", "right", "right", "right"]}
              >
                {receivables.items.map((s) => (
                  <tr key={s.saleId}>
                    <Td>{dateStr(s.date)}</Td>
                    <Td>{s.invoiceNumber || "—"}{s.overCredited && <Badge tone="red">over-credited</Badge>}</Td>
                    <Td>
                      {s.overdue
                        ? <Badge tone="red">{s.ageDays}d overdue</Badge>
                        : <span className="text-xs text-slate">{s.ageDays}d</span>}
                    </Td>
                    <Td right>{money(s.totalCents)}</Td>
                    <Td right className={s.creditsCents > 0 ? "text-burnt" : ""}>
                      {s.creditsCents > 0 ? `−${money(s.creditsCents)}` : "—"}
                    </Td>
                    <Td right className={s.paidCents > 0 ? "text-agave-deep" : ""}>
                      {s.paidCents > 0 ? `−${money(s.paidCents)}` : "—"}
                    </Td>
                    <Td right className="font-medium">{money(s.netDueCents)}</Td>
                  </tr>
                ))}
              </Table>
            )}
            {receivables.items.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Current (≤30d)" value={money(receivables.aging.current)} />
                <Stat label="31–60 days" value={money(receivables.aging.d31to60)} tone={receivables.aging.d31to60 > 0 ? "reposado" : "ink"} />
                <Stat label="61–90 days" value={money(receivables.aging.d61to90)} tone={receivables.aging.d61to90 > 0 ? "reposado" : "ink"} />
                <Stat label="90+ days" value={money(receivables.aging.d90plus)} tone={receivables.aging.d90plus > 0 ? "burnt" : "ink"} />
              </div>
            )}
            {anyOverCredited && (
              <p className="mt-2 text-xs font-medium text-burnt">
                One or more invoices have credits exceeding their total — check the chargeback ledger for a
                mis-applied billback.
              </p>
            )}
            <p className="mt-3 text-xs text-slate/70">
              Age counts from the due date when set, else the invoice date. Credits are LSI chargebacks
              applied against invoices; paid amounts are partial remittances recorded on Ex-Works Sales.
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

          {me?.role === "ADMIN" && (
            <Card title="QuickBooks Online sync">
              {!qboEnabled ? (
                <p className="text-xs leading-relaxed text-slate/80">
                  Live sync is ready to activate: create an app at developer.intuit.com (Accounting scope),
                  set its redirect URI to <span className="font-mono">/api/qbo/callback</span> on this
                  domain, then add <span className="font-mono">QBO_CLIENT_ID</span> and{" "}
                  <span className="font-mono">QBO_CLIENT_SECRET</span> env vars in Render. Until then, the
                  file upload above does the same job.
                </p>
              ) : !qbo ? (
                <div>
                  <p className="mb-3 text-sm text-ink/85">
                    Connect the DNA Spirits QuickBooks company to pull the P&amp;L directly.
                  </p>
                  <a
                    href="/api/qbo/connect"
                    className="inline-block rounded-md bg-agave px-4 py-2 text-sm font-medium text-cream hover:bg-agave-deep"
                  >
                    Connect QuickBooks
                  </a>
                </div>
              ) : (
                <div>
                  <p className="mb-3 text-sm text-ink/85">
                    Connected to company {qbo.realmId}.
                    {qbo.lastSyncAt && ` Last synced ${dateStr(qbo.lastSyncAt)}.`}
                  </p>
                  <form action={syncQbo}>
                    <button className={btnCls}>Sync P&L now</button>
                  </form>
                  <p className="mt-2 text-xs text-slate/70">
                    Pulls this year and last year by month, replacing those periods — same as an upload.
                  </p>
                </div>
              )}
            </Card>
          )}

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
