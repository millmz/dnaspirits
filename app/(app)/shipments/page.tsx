import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, num, dateStr } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls, btnSecondaryCls, EmptyState } from "@/components/ui";
import { createShipment, markShipped, markPaid, deleteDraft } from "./actions";

export default async function ShipmentsPage() {
  await requireUser();
  const [shipments, distributors, warehouses, products] = await Promise.all([
    db.shipment.findMany({
      orderBy: { date: "desc" },
      include: { distributor: true, warehouse: true, lines: { include: { product: true } } },
    }),
    db.distributor.findMany({ orderBy: { name: "asc" } }),
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
    db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Shipments"
        subtitle="Sales to distributors. Marking a shipment shipped draws down warehouse inventory."
      />

      {distributors.length === 0 ? (
        <Card>
          <EmptyState>Add a distributor first, then record shipments here.</EmptyState>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card title="All shipments">
              {shipments.length === 0 ? (
                <EmptyState>No shipments yet — create one on the right.</EmptyState>
              ) : (
                <div className="space-y-4">
                  {shipments.map((s) => {
                    const cases = s.lines.reduce((a, l) => a + l.cases, 0);
                    const value = s.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
                    return (
                      <div key={s.id} className="rounded-lg border border-stone-200 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">
                            {s.distributor.name}
                            <span className="ml-2 text-sm font-normal text-stone-500">{dateStr(s.date)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {s.status === "DRAFT" ? <Badge>Draft</Badge>
                              : s.invoiceStatus === "PAID" ? <Badge tone="green">Shipped · Paid</Badge>
                              : <Badge tone="amber">Shipped · Unpaid</Badge>}
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-stone-600">
                          {s.lines.map((l) => (
                            <div key={l.id}>
                              {num(l.cases)} cases · {l.product.name} @ {money(l.pricePerCaseCents)}/case
                            </div>
                          ))}
                        </div>
                        <div className="mt-1 text-sm text-stone-500">
                          {num(cases)} cases · {money(value)} total
                          {s.invoiceNumber && ` · Invoice ${s.invoiceNumber}`}
                          {` · from ${s.warehouse.name}`}
                        </div>
                        <div className="mt-3 flex gap-2">
                          {s.status === "DRAFT" && (
                            <>
                              <form action={markShipped}>
                                <input type="hidden" name="id" value={s.id} />
                                <button className={btnCls}>Mark shipped</button>
                              </form>
                              <form action={deleteDraft}>
                                <input type="hidden" name="id" value={s.id} />
                                <button className={btnSecondaryCls}>Delete draft</button>
                              </form>
                            </>
                          )}
                          {s.status === "SHIPPED" && s.invoiceStatus === "UNPAID" && (
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

          <Card title="New shipment">
            <form action={createShipment} className="space-y-3">
              <Field label="Distributor">
                <select name="distributorId" required className={inputCls}>
                  {distributors.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}{d.market ? ` (${d.market})` : ""}</option>
                  ))}
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

              <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
                Lines (price blank = default case price)
              </div>
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid grid-cols-[1fr_70px_84px] gap-2">
                  <select name={`line${i}_productId`} className={inputCls} defaultValue={i === 0 ? undefined : ""}>
                    {i !== 0 && <option value="">—</option>}
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
              <p className="text-xs text-stone-400">
                Shipments start as drafts; marking shipped checks stock and posts the inventory draw-down.
              </p>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
