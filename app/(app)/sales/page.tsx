import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, num, dateStr } from "@/lib/format";
import { PageHeader, Card, Badge, Field, inputCls, btnCls, btnSecondaryCls, EmptyState } from "@/components/ui";
import { createSale, confirmSale, markPaid, deleteDraft } from "./actions";

export default async function SalesPage() {
  await requireOps();
  const [sales, importers, warehouses, products] = await Promise.all([
    db.exWorksSale.findMany({
      orderBy: { date: "desc" },
      include: { importer: true, warehouse: true, lines: { include: { product: true } } },
    }),
    db.importer.findMany({ orderBy: { name: "asc" } }),
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
    db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        label="Market · United States"
        title="Ex-Works Sales"
        subtitle="Sales to your importer at the distillery door. Confirming a sale hands off ownership — finished goods leave your books and the invoice becomes a receivable."
      />

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
                  return (
                    <div key={s.id} className="rounded-md border border-ink/10 bg-white/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">
                          {s.importer.name}
                          <span className="ml-2 text-sm font-normal text-slate">{dateStr(s.date)}</span>
                        </div>
                        {s.status === "DRAFT" ? <Badge>Draft</Badge>
                          : s.invoiceStatus === "PAID" ? <Badge tone="green">Confirmed · Paid</Badge>
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
                        {` · ex-works ${s.warehouse.name}`}
                      </div>
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
                          <form action={markPaid}>
                            <input type="hidden" name="id" value={s.id} />
                            <button className={btnSecondaryCls}>Mark invoice paid</button>
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
            <Field label="Invoice #">
              <input name="invoiceNumber" placeholder="INV-1042" className={inputCls} />
            </Field>

            <div className="brand-heading pt-1 text-[11px] font-medium text-slate">
              Lines (price blank = ex-works price)
            </div>
            {[0, 1, 2].map((i) => (
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
    </div>
  );
}
