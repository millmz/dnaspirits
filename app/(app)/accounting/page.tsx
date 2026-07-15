import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, dateStr, num } from "@/lib/format";
import { PageHeader, Card, Stat, Table, Td, Badge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { createExpense, deleteExpense } from "./actions";

const CATEGORIES = [
  ["COGS", "COGS / Production"],
  ["MARKETING", "Marketing"],
  ["LOGISTICS", "Logistics / Freight"],
  ["COMPLIANCE", "Compliance / Legal"],
  ["G_AND_A", "General & Admin"],
  ["OTHER", "Other"],
] as const;

const catLabel = (key: string) =>
  CATEGORIES.find(([k]) => k === key)?.[1] ?? key;

export default async function AccountingPage() {
  await requireUser();

  const year = new Date().getFullYear();
  const yearStart = new Date(`${year}-01-01`);

  const [expenses, shippedThisYear, unpaid] = await Promise.all([
    db.expense.findMany({ orderBy: { date: "desc" }, take: 100 }),
    db.shipment.findMany({
      where: { status: "SHIPPED", date: { gte: yearStart } },
      include: { lines: { include: { product: true } } },
    }),
    db.shipment.findMany({
      where: { status: "SHIPPED", invoiceStatus: "UNPAID" },
      include: { distributor: true, lines: true },
      orderBy: { date: "asc" },
    }),
  ]);

  const revenueCents = shippedThisYear.reduce(
    (a, s) => a + s.lines.reduce((x, l) => x + l.cases * l.pricePerCaseCents, 0),
    0
  );
  const cogsCents = shippedThisYear.reduce(
    (a, s) => a + s.lines.reduce((x, l) => x + l.cases * l.product.caseCostCents, 0),
    0
  );

  const expensesYtd = await db.expense.groupBy({
    by: ["category"],
    where: { date: { gte: yearStart } },
    _sum: { amountCents: true },
  });
  const opexCents = expensesYtd
    .filter((e) => e.category !== "COGS")
    .reduce((a, e) => a + (e._sum.amountCents ?? 0), 0);
  const netCents = revenueCents - cogsCents - opexCents;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Accounting"
        subtitle={`${year} year-to-date. QuickBooks stays your ledger of record — use this view for real-time operating numbers.`}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Revenue (shipped)" value={money(revenueCents)} hint="Invoiced shipments, YTD" />
        <Stat label="COGS (shipped)" value={money(cogsCents)} hint="From product case costs" />
        <Stat label="Operating expenses" value={money(opexCents)} hint="Logged expenses, ex-COGS" />
        <Stat
          label="Net (approx.)"
          value={money(netCents)}
          hint={netCents >= 0 ? "Revenue − COGS − OpEx" : "Operating at a loss YTD"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Open receivables">
            {unpaid.length === 0 ? (
              <EmptyState>No unpaid invoices. 🎉</EmptyState>
            ) : (
              <Table headers={["Date", "Distributor", "Invoice", "Amount"]} align={["left", "left", "left", "right"]}>
                {unpaid.map((s) => (
                  <tr key={s.id}>
                    <Td>{dateStr(s.date)}</Td>
                    <Td>{s.distributor.name}</Td>
                    <Td>{s.invoiceNumber || "—"}</Td>
                    <Td right>{money(s.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0))}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Expenses">
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
                    <Td className="text-stone-500">{e.notes}</Td>
                    <Td>
                      <form action={deleteExpense}>
                        <input type="hidden" name="id" value={e.id} />
                        <button className="text-xs text-stone-400 hover:text-red-600">Delete</button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
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
                <input name="vendor" required placeholder="Glass supplier / FedEx / Agency" className={inputCls} />
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
