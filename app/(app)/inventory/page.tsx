import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStock } from "@/lib/inventory";
import { num, dateStr } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, TierBadge, Field, inputCls, btnCls, EmptyState, Callout } from "@/components/ui";
import { adjustInventory, transferInventory } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const MOVEMENT_TONES: Record<string, "green" | "amber" | "blue" | "gray"> = {
  PRODUCTION: "green",
  EX_WORKS_SALE: "blue",
  TRANSFER: "blue",
  ADJUSTMENT: "amber",
  SAMPLES: "amber",
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; moved?: string }>;
}) {
  await requireOps();
  const { err, moved } = await searchParams;
  const [stock, warehouses, products, movements] = await Promise.all([
    getStock(),
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
    db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
    db.inventoryMovement.findMany({
      orderBy: { date: "desc" },
      take: 25,
      include: { product: true, warehouse: true },
    }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        label="Supply Chain"
        title="Finished Goods"
        subtitle="Bottled stock you own — at the distillery in Mexico and, after transfer, at your U.S. warehouse. Computed from the full movement ledger."
      />

      {moved && <Callout tone="green">Transferred {num(Number(moved))} bottles between warehouses.</Callout>}
      {err && <Callout tone="red">{err}</Callout>}

      <Card title="Stock on hand">
        {stock.length === 0 ? (
          <EmptyState>No products yet.</EmptyState>
        ) : (
          <Table
            headers={["SKU", "Product", "Tier", ...warehouses.map((w) => w.name), "Bottles", "Cases", "Pallets"]}
            align={["left", "left", "left", ...warehouses.map(() => "right" as const), "right", "right", "right"]}
          >
            {stock.map((s) => {
              const cases = Math.floor(s.totalBottles / s.bottlesPerCase);
              return (
                <tr key={s.productId}>
                  <Td><span className="font-mono text-xs">{s.sku}</span></Td>
                  <Td>{s.name}</Td>
                  <Td><TierBadge tier={s.tier} /></Td>
                  {warehouses.map((w) => (
                    <Td key={w.id} right>{num(s.byWarehouse[w.id] ?? 0)}</Td>
                  ))}
                  <Td right className="font-medium">{num(s.totalBottles)}</Td>
                  <Td right>{num(cases)}</Td>
                  <Td right>{s.casesPerPallet > 0 ? (Math.floor((cases / s.casesPerPallet) * 10) / 10).toFixed(1) : "—"}</Td>
                </tr>
              );
            })}
          </Table>
        )}
        <p className="mt-3 text-xs text-slate/70">
          Warehouse columns show bottles. Pallets assume each product&apos;s configured cases per pallet (Products &amp; BOM).
        </p>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card title="Transfer between warehouses">
            <form action={transferInventory} className="space-y-3">
              <Field label="Product">
                <select name="productId" className={inputCls}>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  <select name="fromWarehouseId" className={inputCls}>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </Field>
                <Field label="To">
                  <select name="toWarehouseId" className={inputCls} defaultValue={warehouses[1]?.id}>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Bottles">
                  <input name="bottles" type="number" required placeholder="840" className={inputCls} />
                </Field>
                <Field label="Date">
                  <input name="date" type="date" defaultValue={today} className={inputCls} />
                </Field>
              </div>
              <Field label="Notes">
                <input name="notes" placeholder="Container / shipment reference" className={inputCls} />
              </Field>
              <SubmitButton>Transfer</SubmitButton>
              <p className="text-xs leading-relaxed text-slate/70">
                Use for Mexico → U.S. shipments (or any warehouse move). The transfer refuses if the source
                doesn&apos;t hold enough stock. Tip: a full pallet is 140 cases × 6 = 840 bottles.
              </p>
            </form>
          </Card>

          <Card title="Record adjustment / samples" collapsible>
            <form action={adjustInventory} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Product">
                  <select name="productId" className={inputCls}>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Warehouse">
                  <select name="warehouseId" className={inputCls}>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Type">
                  <select name="type" className={inputCls}>
                    <option value="ADJUSTMENT">Adjustment</option>
                    <option value="SAMPLES">Samples</option>
                  </select>
                </Field>
                <Field label="Bottles (+/-)">
                  <input name="bottles" type="number" required placeholder="-12" className={inputCls} />
                </Field>
                <Field label="Date">
                  <input name="date" type="date" defaultValue={today} className={inputCls} />
                </Field>
              </div>
              <Field label="Notes">
                <input name="notes" placeholder="Breakage / importer samples" className={inputCls} />
              </Field>
              <SubmitButton>Record</SubmitButton>
            </form>
          </Card>
        </div>

        <Card title="Recent movements">
          {movements.length === 0 ? (
            <EmptyState>No movements yet. Complete a production run to add stock.</EmptyState>
          ) : (
            <Table headers={["Date", "Product", "Warehouse", "Type", "Bottles", "Notes"]} align={["left", "left", "left", "left", "right", "left"]}>
              {movements.map((m) => (
                <tr key={m.id}>
                  <Td>{dateStr(m.date)}</Td>
                  <Td>{m.product.name}</Td>
                  <Td className="text-xs">{m.warehouse.name}</Td>
                  <Td><Badge tone={MOVEMENT_TONES[m.type] ?? "gray"}>{m.type.replace(/_/g, " ")}</Badge></Td>
                  <Td right className={m.bottles < 0 ? "text-burnt" : "text-agave-deep"}>
                    {m.bottles > 0 ? `+${num(m.bottles)}` : num(m.bottles)}
                  </Td>
                  <Td className="text-slate">{m.notes}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
