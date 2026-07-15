import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStock } from "@/lib/inventory";
import { num, dateStr } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, TierBadge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { adjustInventory } from "./actions";

const MOVEMENT_TONES: Record<string, "green" | "amber" | "blue" | "gray"> = {
  PRODUCTION: "green",
  EX_WORKS_SALE: "blue",
  ADJUSTMENT: "amber",
  SAMPLES: "amber",
};

export default async function InventoryPage() {
  await requireOps();
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
        label="Supply Chain · Mexico"
        title="Finished Goods"
        subtitle="Bottled stock you own, held in Mexico until it sells ex-works to the importer. Computed from the full movement ledger."
      />

      <Card title="Stock on hand">
        {stock.length === 0 ? (
          <EmptyState>No products yet.</EmptyState>
        ) : (
          <Table
            headers={["SKU", "Product", "Tier", ...warehouses.map((w) => w.name), "Total bottles", "Total cases"]}
            align={["left", "left", "left", ...warehouses.map(() => "right" as const), "right", "right"]}
          >
            {stock.map((s) => (
              <tr key={s.productId}>
                <Td><span className="font-mono text-xs">{s.sku}</span></Td>
                <Td>{s.name}</Td>
                <Td><TierBadge tier={s.tier} /></Td>
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
              <input name="notes" placeholder="Breakage / importer samples" className={inputCls} />
            </Field>
            <button className={btnCls}>Record</button>
          </form>
        </Card>

        <Card title="Recent movements">
          {movements.length === 0 ? (
            <EmptyState>No movements yet. Complete a production run to add stock.</EmptyState>
          ) : (
            <Table headers={["Date", "Product", "Type", "Bottles", "Notes"]} align={["left", "left", "left", "right", "left"]}>
              {movements.map((m) => (
                <tr key={m.id}>
                  <Td>{dateStr(m.date)}</Td>
                  <Td>{m.product.name}</Td>
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
