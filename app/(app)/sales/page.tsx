import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, num, dateStr } from "@/lib/format";
import { PageHeader, Card, Badge, Field, Table, Td, inputCls, btnCls, btnSecondaryCls, EmptyState, Callout } from "@/components/ui";
import { createSale, confirmSale, unconfirmSale, markPaid, markUnpaid, recordPayment, deleteDraft, createChargeback, deleteChargeback } from "./actions";

const CB_CATEGORIES = [
  ["DISTRIBUTOR_PROMO", "Distributor promo / billback"],
  ["SAMPLES", "Samples"],
  ["FREIGHT", "Freight"],
  ["MARKETING", "Marketing"],
  ["OTHER", "Other"],
] as const;

const cbLabel = (k: string) => CB_CATEGORIES.find(([c]) => c === k)?.[1] ?? k;

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  await requireOps();
  const { err } = await searchParams;
  const [sales, importers, warehouses, products, chargebacks] = await Promise.all([
    db.exWorksSale.findMany({
      orderBy: { date: "desc" },
      include: { importer: true, warehouse: true, lines: { include: { product: true } }, chargebacks: true },
    }),
    db.importer.findMany({ orderBy: { name: "asc" } }),
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
    db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
    db.chargeback.findMany({
      orderBy: { date: "desc" },
      take: 30,
      include: { importer: true, sale: true },
    }),
  ]);

  const openInvoices = sales.filter((s) => s.status === "CONFIRMED" && s.invoiceStatus === "UNPAID");

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        label="Market · United States"
        title="Ex-Works Sales"
        subtitle="Sales to your importer at the distillery door. Confirming a sale hands off ownership — finished goods leave your books and the invoice becomes a receivable."
      />

      {err && (
        <div className="mb-4">
          <Callout tone="red">{err}</Callout>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="All sales">
            {sales.length === 0 ? (
              <EmptyState>No ex-works sales yet — create one on the right.</EmptyState>
            ) : (
              <div className="space-y-4">
                {sales.map((s) => {
                  const cases = s.lines.reduce((a, l) => a + l.cases, 0);
                  const value = s.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
                  const credits = s.chargebacks.reduce((a, c) => a + c.amountCents, 0);
                  return (
                    <div key={s.id} className="rounded-md border border-ink/10 bg-white/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">
                          {s.importer.name}
                          <span className="ml-2 text-sm font-normal text-slate">{dateStr(s.date)}</span>
                        </div>
                        {s.status === "DRAFT" ? <Badge>Draft</Badge>
                          : s.invoiceStatus === "PAID" ? <Badge tone="green">Confirmed · Paid</Badge>
                          : s.amountPaidCents > 0 ? <Badge tone="blue">Confirmed · Partially paid</Badge>
                          : <Badge tone="amber">Confirmed · Unpaid</Badge>}
                      </div>
                      <div className="mt-2 text-sm text-ink/80">
                        {s.lines.map((l) => (
                          <div key={l.id}>
                            {num(l.cases)} cases · {l.product.name} @ {money(l.pricePerCaseCents)}/case
                          </div>
                        ))}
                      </div>
                      <div className="mt-1 text-sm text-slate">
                        {num(cases)} cases · {money(value)} total
                        {s.invoiceNumber && ` · Invoice ${s.invoiceNumber}`}
                        {s.dueDate && s.invoiceStatus === "UNPAID" && ` · due ${dateStr(s.dueDate)}`}
                        {s.amountPaidCents > 0 && s.invoiceStatus === "UNPAID" && ` · ${money(s.amountPaidCents)} received`}
                        {` · ex-works ${s.warehouse.name}`}
                      </div>
                      {credits > 0 && (
                        <div className="mt-1 text-sm">
                          <span className="text-burnt">− {money(credits)} chargeback credits</span>
                          {s.invoiceStatus === "UNPAID" && (
                            <span className="ml-2 font-medium text-ink">net due {money(Math.max(0, value - credits))}</span>
                          )}
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        {s.status === "DRAFT" && (
                          <>
                            <form action={confirmSale}>
                              <input type="hidden" name="id" value={s.id} />
                              <button className={btnCls}>Confirm sale</button>
                            </form>
                            <form action={deleteDraft}>
                              <input type="hidden" name="id" value={s.id} />
                              <button className={btnSecondaryCls}>Delete draft</button>
                            </form>
                          </>
                        )}
                        {s.status === "CONFIRMED" && s.invoiceStatus === "UNPAID" && (
                          <>
                            <form action={recordPayment} className="flex items-center gap-2">
                              <input type="hidden" name="id" value={s.id} />
                              <input name="amount" placeholder="$ received" className={`${inputCls} w-28`} />
                              <input name="date" type="date" defaultValue={today} className={`${inputCls} w-36`} />
                              <button className={btnSecondaryCls}>Record payment</button>
                            </form>
                            <form action={markPaid} className="flex items-center gap-2">
                              <input type="hidden" name="id" value={s.id} />
                              <input type="hidden" name="date" value={today} />
                              <button className="px-1 py-1.5 text-xs text-agave underline-offset-2 hover:underline">Mark fully paid</button>
                            </form>
                            {s.amountPaidCents === 0 && (
                              <form action={unconfirmSale}>
                                <input type="hidden" name="id" value={s.id} />
                                <button className="px-1 py-1.5 text-xs text-slate/60 hover:text-burnt">Undo confirm</button>
                              </form>
                            )}
                          </>
                        )}
                        {s.status === "CONFIRMED" && s.invoiceStatus === "PAID" && (
                          <form action={markUnpaid}>
                            <input type="hidden" name="id" value={s.id} />
                            <button className="px-1 py-1.5 text-xs text-slate/60 hover:text-burnt">Mark unpaid (undo)</button>
                          </form>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <Card title="New ex-works sale">
          <form action={createSale} className="space-y-3">
            <Field label="Importer">
              <select name="importerId" required className={inputCls}>
                {importers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From warehouse">
                <select name="warehouseId" required className={inputCls}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </Field>
              <Field label="Date">
                <input name="date" type="date" defaultValue={today} className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice #">
                <input name="invoiceNumber" placeholder="INV-1042" className={inputCls} />
              </Field>
              <Field label="Payment due (optional)">
                <input name="dueDate" type="date" className={inputCls} />
              </Field>
            </div>

            <div className="brand-heading pt-1 text-[11px] font-medium text-slate">
              Lines (price blank = ex-works price)
            </div>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="grid grid-cols-[1fr_70px_84px] gap-2">
                <select name={`line${i}_productId`} className={inputCls} defaultValue="">
                  <option value="">—</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.sku}</option>)}
                </select>
                <input name={`line${i}_cases`} type="number" placeholder="Cases" className={inputCls} />
                <input name={`line${i}_price`} placeholder="$/case" className={inputCls} />
              </div>
            ))}

            <Field label="Notes">
              <input name="notes" className={inputCls} />
            </Field>
            <button className={btnCls}>Create draft</button>
            <p className="text-xs text-slate/70">
              Sales start as drafts; confirming checks finished-goods stock and posts the draw-down.
            </p>
          </form>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Chargeback ledger">
            {chargebacks.length === 0 ? (
              <EmptyState>
                No chargebacks recorded. When LSI bills back promos, samples or freight — or nets them
                against a remittance — record them here.
              </EmptyState>
            ) : (
              <Table
                headers={["Date", "Importer", "Category", "Amount", "Applied to", "Ref", "Notes", ""]}
                align={["left", "left", "left", "right", "left", "left", "left", "left"]}
              >
                {chargebacks.map((c) => (
                  <tr key={c.id}>
                    <Td>{dateStr(c.date)}</Td>
                    <Td className="text-xs">{c.importer.name}</Td>
                    <Td><Badge tone="amber">{cbLabel(c.category)}</Badge></Td>
                    <Td right className="text-burnt">−{money(c.amountCents)}</Td>
                    <Td className="text-xs">
                      {c.sale
                        ? c.sale.invoiceNumber || dateStr(c.sale.date)
                        : <Badge>Unapplied</Badge>}
                    </Td>
                    <Td className="font-mono text-xs">{c.reference || "—"}</Td>
                    <Td className="max-w-48 text-xs text-slate">{c.notes}</Td>
                    <Td>
                      <form action={deleteChargeback}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="text-xs text-slate/60 hover:text-burnt">Delete</button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="mt-3 text-xs text-slate/70">
              Credits applied to an invoice reduce its collectible balance on this page, the dashboard and
              Accounting. Unapplied credits sit in the ledger until you attach them to an invoice.
            </p>
          </Card>
        </div>

        <Card title="Record chargeback">
          <form action={createChargeback} className="space-y-3">
            <Field label="Importer">
              <select name="importerId" className={inputCls}>
                {importers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select name="category" className={inputCls}>
                  {CB_CATEGORIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </Field>
              <Field label="Date">
                <input name="date" type="date" defaultValue={today} className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount ($)">
                <input name="amount" required placeholder="1250.00" className={inputCls} />
              </Field>
              <Field label="LSI ref #">
                <input name="reference" placeholder="Statement / billback no." className={inputCls} />
              </Field>
            </div>
            <Field label="Apply against invoice (optional)">
              <select name="saleId" className={inputCls} defaultValue="">
                <option value="">— leave unapplied —</option>
                {openInvoices.map((s) => {
                  const total = s.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
                  return (
                    <option key={s.id} value={s.id}>
                      {s.invoiceNumber || dateStr(s.date)} · {money(total)}
                    </option>
                  );
                })}
              </select>
            </Field>
            <Field label="Notes">
              <input name="notes" placeholder="e.g. Q2 NY distributor depletion allowance" className={inputCls} />
            </Field>
            <button className={btnCls}>Record chargeback</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
