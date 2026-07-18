import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, num, dateStr } from "@/lib/format";
import Link from "next/link";
import { PageHeader, Card, Badge, Field, inputCls, btnCls, btnSecondaryCls, EmptyState, Callout } from "@/components/ui";
import { createRun, startRun, completeRun, deleteRun, uncompleteRun } from "./actions";

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  await requireOps();
  const { err } = await searchParams;
  const [runs, products, warehouses] = await Promise.all([
    db.productionRun.findMany({
      orderBy: { startDate: "desc" },
      include: { product: true, warehouse: true },
    }),
    db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        label="Supply Chain · Mexico"
        title="Production"
        subtitle="Each batch at the contract distillery, tracked by lot. Completing a run adds bottles to finished goods and consumes dry goods per the BOM."
      />

      <Link href="/production/plan" className="brand-heading mb-4 inline-block text-sm text-agave hover:underline">
        Run planner: check dry-goods coverage before committing →
      </Link>

      {err && <Callout tone="red">{err}</Callout>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="All runs">
            {runs.length === 0 ? (
              <EmptyState>No production runs yet — plan one on the right.</EmptyState>
            ) : (
              <div className="space-y-4">
                {runs.map((r) => (
                  <div key={r.id} className="rounded-md border border-ink/10 bg-white/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Link href={`/production/lot/${encodeURIComponent(r.lotCode)}`} className="brand-heading text-sm font-medium text-agave-deep hover:underline">
                          {r.lotCode}
                        </Link>
                        <span className="ml-3 text-sm text-slate">{r.product.name}</span>
                      </div>
                      {r.status === "COMPLETED" ? (
                        <Badge tone="green">Completed {dateStr(r.bottledDate)}</Badge>
                      ) : r.status === "IN_PROGRESS" ? (
                        <Badge tone="blue">In progress</Badge>
                      ) : (
                        <Badge>Planned</Badge>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate sm:grid-cols-4">
                      <div>Started: {dateStr(r.startDate)}</div>
                      <div>
                        Bottles: {r.status === "COMPLETED"
                          ? `${num(r.bottlesProduced)} actual`
                          : `${num(r.bottlesPlanned)} planned`}
                      </div>
                      <div>Cost: {money(r.totalCostCents)}</div>
                      <div>To: {r.warehouse.name}</div>
                      {r.agaveSource && <div className="col-span-2">Agave: {r.agaveSource}</div>}
                      {r.distillery && <div className="col-span-2">Distillery: {r.distillery}</div>}
                      {r.notes && <div className="col-span-full text-slate/70">{r.notes}</div>}
                    </div>

                    {r.status === "PLANNED" && (
                      <div className="mt-3 flex items-center gap-3">
                        <form action={startRun}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className={btnSecondaryCls}>Mark in progress</button>
                        </form>
                        <form action={deleteRun}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="text-xs text-slate/60 hover:text-burnt">Delete run</button>
                        </form>
                      </div>
                    )}
                    {r.status === "COMPLETED" && (
                      <form action={uncompleteRun} className="mt-2">
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-xs text-slate/60 underline-offset-2 hover:text-burnt hover:underline">
                          Undo completion (returns bottles &amp; dry goods)
                        </button>
                      </form>
                    )}
                    {r.status === "IN_PROGRESS" && (
                      <form action={completeRun} className="mt-3 flex flex-wrap items-end gap-3">
                        <input type="hidden" name="id" value={r.id} />
                        <Field label="Actual bottles" className="w-32">
                          <input name="bottlesProduced" type="number" required defaultValue={r.bottlesPlanned} className={inputCls} />
                        </Field>
                        <Field label="Bottled date" className="w-40">
                          <input name="bottledDate" type="date" defaultValue={today} className={inputCls} />
                        </Field>
                        <Field label="Final cost ($, optional)" className="w-36">
                          <input name="totalCost" placeholder={(r.totalCostCents / 100).toFixed(2)} className={inputCls} />
                        </Field>
                        <button className={btnCls}>Complete run</button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card title="Plan a run">
          <form action={createRun} className="space-y-3">
            <Field label="Lot code">
              <input name="lotCode" required placeholder="LOT-2026-014" className={inputCls} />
            </Field>
            <Field label="Product">
              <select name="productId" required className={inputCls}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Destination warehouse">
              <select name="warehouseId" required className={inputCls}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date">
                <input name="startDate" type="date" defaultValue={today} className={inputCls} />
              </Field>
              <Field label="Bottles planned">
                <input name="bottlesPlanned" type="number" required className={inputCls} />
              </Field>
            </div>
            <Field label="Agave source (optional)">
              <input name="agaveSource" placeholder="Los Altos, Jalisco" className={inputCls} />
            </Field>
            <Field label="Distillery / NOM (optional)">
              <input name="distillery" placeholder="NOM 1234" className={inputCls} />
            </Field>
            <Field label="Estimated total cost ($)">
              <input name="totalCost" placeholder="15000.00" className={inputCls} />
            </Field>
            <Field label="Notes">
              <textarea name="notes" rows={2} className={inputCls} />
            </Field>
            <button className={btnCls}>Plan run</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
