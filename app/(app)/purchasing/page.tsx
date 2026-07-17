import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, num, dateStr } from "@/lib/format";
import { PageHeader, Card, Badge, Field, inputCls, btnCls, btnSecondaryCls, EmptyState, Callout } from "@/components/ui";
import { createPO, receivePO, unreceivePO, cancelPO } from "./actions";

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  await requireOps();
  const { err } = await searchParams;
  const [pos, suppliers, components] = await Promise.all([
    db.purchaseOrder.findMany({
      orderBy: { orderDate: "desc" },
      include: { supplier: true, lines: { include: { component: true } } },
    }),
    db.supplier.findMany({ orderBy: { name: "asc" } }),
    db.component.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        label="Supply Chain · Mexico"
        title="Purchasing"
        subtitle="Purchase orders to your Mexican suppliers. Receiving a PO adds the goods to dry-goods stock automatically."
      />

      {err && (
        <div className="mb-4">
          <Callout tone="red">{err}</Callout>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Purchase orders">
            {pos.length === 0 ? (
              <EmptyState>No purchase orders yet — create one on the right.</EmptyState>
            ) : (
              <div className="space-y-4">
                {pos.map((po) => {
                  const total = po.lines.reduce((a, l) => a + l.qty * l.unitCostCents, 0);
                  return (
                    <div key={po.id} className="rounded-md border border-ink/10 bg-white/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="brand-heading text-sm font-medium">{po.poNumber}</span>
                          <span className="ml-3 text-sm text-slate">{po.supplier.name}</span>
                        </div>
                        {po.status === "RECEIVED" ? (
                          <Badge tone="green">Received {dateStr(po.receivedDate)}</Badge>
                        ) : po.status === "CANCELLED" ? (
                          <Badge tone="red">Cancelled</Badge>
                        ) : (
                          <Badge tone="amber">Ordered {dateStr(po.orderDate)}</Badge>
                        )}
                      </div>
                      <div className="mt-2 text-sm text-ink/80">
                        {po.lines.map((l) => (
                          <div key={l.id}>
                            {num(l.qty)} × {l.component.name} @ {money(l.unitCostCents)}
                          </div>
                        ))}
                      </div>
                      <div className="mt-1 text-sm text-slate">
                        Total {money(total)}
                        {po.expectedDate && po.status === "ORDERED" && ` · expected ${dateStr(po.expectedDate)}`}
                        {po.notes && ` · ${po.notes}`}
                      </div>
                      {po.status === "RECEIVED" && (
                        <form action={unreceivePO} className="mt-2">
                          <input type="hidden" name="id" value={po.id} />
                          <button className="text-xs text-slate/60 underline-offset-2 hover:text-burnt hover:underline">
                            Undo receipt (returns the stock)
                          </button>
                        </form>
                      )}
                      {po.status === "ORDERED" && (
                        <div className="mt-3 flex flex-wrap items-end gap-3">
                          <form action={receivePO} className="flex items-end gap-3">
                            <input type="hidden" name="id" value={po.id} />
                            <Field label="Received date" className="w-40">
                              <input name="receivedDate" type="date" defaultValue={today} className={inputCls} />
                            </Field>
                            <button className={btnCls}>Receive into stock</button>
                          </form>
                          <form action={cancelPO}>
                            <input type="hidden" name="id" value={po.id} />
                            <button className={btnSecondaryCls}>Cancel</button>
                          </form>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <Card title="New purchase order">
          {suppliers.length === 0 ? (
            <EmptyState>Add a supplier on the Dry Goods page first.</EmptyState>
          ) : (
            <form action={createPO} className="space-y-3">
              <Field label="PO number">
                <input name="poNumber" required placeholder="PO-2026-011" className={inputCls} />
              </Field>
              <Field label="Supplier">
                <select name="supplierId" required className={inputCls}>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Order date">
                  <input name="orderDate" type="date" defaultValue={today} className={inputCls} />
                </Field>
                <Field label="Expected">
                  <input name="expectedDate" type="date" className={inputCls} />
                </Field>
              </div>

              <div className="brand-heading pt-1 text-[11px] font-medium text-slate">
                Lines (cost blank = current unit cost)
              </div>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="grid grid-cols-[1fr_70px_80px] gap-2">
                  <select name={`line${i}_componentId`} className={inputCls} defaultValue="">
                    <option value="">—</option>
                    {components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input name={`line${i}_qty`} placeholder="Qty" className={inputCls} />
                  <input name={`line${i}_cost`} placeholder="$/unit" className={inputCls} />
                </div>
              ))}

              <Field label="Notes">
                <input name="notes" className={inputCls} />
              </Field>
              <button className={btnCls}>Create PO</button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
