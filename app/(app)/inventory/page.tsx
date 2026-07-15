import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStock } from "@/lib/inventory";
import { num, dateStr } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { adjustInventory, transferInventory } from "./actions";

const MOVEMENT_TONES: Record<string, "green" | "amber" | "red" | "blue" | "gray"> = {
  PRODUCTION: "green",
  SHIPMENT: "blue",
  TRANSFER_IN: "gray",
  TRANSFER_OUT: "gray",
  ADJUSTMENT: "amber",
  SAMPLES: "amber",
};

export default async function InventoryPage() {
  await requireUser();
  const [stock, warehouses, products, movements] = await Promise.all([
    getStock(),
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
    db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
    db.inventoryMovement.findMany({
      orderBy: { date: "desc" },
      take: 30,
      include: { product: true, warehouse: true },
    }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="On-hand stock computed from the full movement ledger — production in, shipments out"
      />

      <Card title="Stock on hand">
        {stock.length === 0 ? (
          <EmptyState>No products yet.</EmptyState>
        ) : (
          <Table
            headers={["SKU", "Product", ...warehouses.map((w) => w.name), "Total bottles", "Total cases"]}
            align={["left", "left", ...warehouses.map(() => "right" as const), "right", "right"]}
          >
            {stock.map((s) => (
              <tr key={s.productId}>
                <Td><span className="font-mono text-xs">{s.sku}</span></Td>
                <Td>{s.name}</Td>
                {warehouses.map((w) => (
                  <Td key={w.id} right>{num(s.byWarehouse[w.id] ?? 0)}</Td>
                ))}
                <Td right className="font-medium">{num(s.totalBottles)}</Td>
                <Td right>{num(Math.floor(s.totalBottles / s.bottlesPerCase))}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Record adjustment / samples">
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
              <input name="notes" placeholder="Breakage in transit / tasting samples for TX" className={inputCls} />
            </Field>
            <button className={btnCls}>Record</button>
          </form>
        </Card>

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
                <select name="toWarehouseId" className={inputCls}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bottles">
                <input name="bottles" type="number" required className={inputCls} />
              </Field>
              <Field label="Date">
                <input name="date" type="date" defaultValue={today} className={inputCls} />
              </Field>
            </div>
            <Field label="Notes">
              <input name="notes" className={inputCls} />
            </Field>
            <button className={btnCls}>Transfer</button>
          </form>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Recent movements">
          {movements.length === 0 ? (
            <EmptyState>No movements yet. Complete a production run to add stock.</EmptyState>
          ) : (
            <Table headers={["Date", "Product", "Warehouse", "Type", "Bottles", "Notes"]} align={["left", "left", "left", "left", "right", "left"]}>
              {movements.map((m) => (
                <tr key={m.id}>
                  <Td>{dateStr(m.date)}</Td>
                  <Td>{m.product.name}</Td>
                  <Td>{m.warehouse.name}</Td>
                  <Td><Badge tone={MOVEMENT_TONES[m.type] ?? "gray"}>{m.type.replace(/_/g, " ")}</Badge></Td>
                  <Td right className={m.bottles < 0 ? "text-red-600" : "text-emerald-700"}>
                    {m.bottles > 0 ? `+${num(m.bottles)}` : num(m.bottles)}
                  </Td>
                  <Td className="text-stone-500">{m.notes}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
