import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { getComponentStock } from "@/lib/inventory";
import { money, num } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { createComponent, adjustComponent, createSupplier } from "./actions";

const CATEGORIES = [
  ["GLASS", "Glass"],
  ["LABEL", "Labels"],
  ["CLOSURE", "Stoppers / Closures"],
  ["CAPSULE", "Capsules / Foil"],
  ["SHIPPER", "Shipper Boxes"],
  ["BULK_TEQUILA", "Bulk Tequila"],
  ["OTHER", "Other"],
] as const;

const catLabel = (k: string) => CATEGORIES.find(([c]) => c === k)?.[1] ?? k;

export default async function ComponentsPage() {
  await requireOps();
  const [components, suppliers, stock, movements] = await Promise.all([
    db.component.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: { supplier: true },
    }),
    db.supplier.findMany({ orderBy: { name: "asc" } }),
    getComponentStock(),
    db.componentMovement.findMany({
      orderBy: { date: "desc" },
      take: 15,
      include: { component: true },
    }),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const low = components.filter(
    (c) => c.reorderPoint > 0 && (stock.get(c.id) ?? 0) < c.reorderPoint
  );

  return (
    <div>
      <PageHeader
        label="Supply Chain · Mexico"
        title="Dry Goods"
        subtitle="Every physical piece of the product — glass, labels, stoppers, capsules, shipper boxes, bulk tequila — with live on-hand counts and reorder flags."
      />

      {low.length > 0 && (
        <div className="mb-5 rounded-md bg-burnt/10 px-4 py-3 text-sm text-burnt">
          <span className="brand-heading font-medium">Reorder needed:</span>{" "}
          {low.map((c) => `${c.name} (${num(Math.round(stock.get(c.id) ?? 0))} on hand, reorder at ${num(c.reorderPoint)}, ${c.leadTimeDays}-day lead)`).join(" · ")}
        </div>
      )}

      <Card title="On hand">
        {components.length === 0 ? (
          <EmptyState>No components yet — add your dry goods below.</EmptyState>
        ) : (
          <Table
            headers={["Component", "Category", "Supplier", "Unit cost", "Lead time", "On hand", "Reorder at", "Status"]}
            align={["left", "left", "left", "right", "right", "right", "right", "left"]}
          >
            {components.map((c) => {
              const onHand = stock.get(c.id) ?? 0;
              const isLow = c.reorderPoint > 0 && onHand < c.reorderPoint;
              return (
                <tr key={c.id}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td><Badge>{catLabel(c.category)}</Badge></Td>
                  <Td>{c.supplier?.name ?? "—"}</Td>
                  <Td right>{money(c.unitCostCents)}</Td>
                  <Td right>{c.leadTimeDays}d</Td>
                  <Td right className="font-medium">{num(Math.round(onHand * 100) / 100)} {c.unit}</Td>
                  <Td right>{c.reorderPoint > 0 ? num(c.reorderPoint) : "—"}</Td>
                  <Td>{isLow ? <Badge tone="red">Reorder</Badge> : <Badge tone="green">OK</Badge>}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Add component">
          <form action={createComponent} className="space-y-3">
            <Field label="Name">
              <input name="name" required placeholder="Glass Bottle 750ml" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select name="category" className={inputCls}>
                  {CATEGORIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </Field>
              <Field label="Unit">
                <select name="unit" className={inputCls}>
                  <option value="pcs">pieces</option>
                  <option value="liters">liters</option>
                </select>
              </Field>
            </div>
            <Field label="Supplier">
              <select name="supplierId" className={inputCls}>
                <option value="">— none —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Unit cost ($)">
                <input name="unitCost" placeholder="1.80" className={inputCls} />
              </Field>
              <Field label="Lead (days)">
                <input name="leadTimeDays" type="number" defaultValue={30} className={inputCls} />
              </Field>
              <Field label="Reorder at">
                <input name="reorderPoint" placeholder="5000" className={inputCls} />
              </Field>
            </div>
            <button className={btnCls}>Add component</button>
          </form>
        </Card>

        <Card title="Adjust count">
          <form action={adjustComponent} className="space-y-3">
            <Field label="Component">
              <select name="componentId" className={inputCls}>
                {components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Qty (+/-)">
                <input name="qty" required placeholder="-250 or 1000" className={inputCls} />
              </Field>
              <Field label="Date">
                <input name="date" type="date" defaultValue={today} className={inputCls} />
              </Field>
            </div>
            <Field label="Notes">
              <input name="notes" placeholder="Physical count correction / damaged" className={inputCls} />
            </Field>
            <button className={btnCls}>Record</button>
            <p className="text-xs text-slate/70">
              Stock also moves automatically: purchase orders add on receipt, production runs consume via BOM.
            </p>
          </form>
        </Card>

        <Card title="Add supplier">
          <form action={createSupplier} className="space-y-3">
            <Field label="Name">
              <input name="name" required placeholder="Vidrio de Guadalajara" className={inputCls} />
            </Field>
            <Field label="Location">
              <input name="location" placeholder="Guadalajara, MX" className={inputCls} />
            </Field>
            <Field label="Contact">
              <input name="contactName" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email">
                <input name="email" type="email" className={inputCls} />
              </Field>
              <Field label="Phone">
                <input name="phone" className={inputCls} />
              </Field>
            </div>
            <button className={btnCls}>Add supplier</button>
          </form>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Recent movements">
          {movements.length === 0 ? (
            <EmptyState>No movements yet.</EmptyState>
          ) : (
            <Table headers={["Date", "Component", "Type", "Qty", "Ref", "Notes"]} align={["left", "left", "left", "right", "left", "left"]}>
              {movements.map((m) => (
                <tr key={m.id}>
                  <Td>{m.date.toISOString().slice(0, 10)}</Td>
                  <Td>{m.component.name}</Td>
                  <Td>
                    <Badge tone={m.type === "PO_RECEIPT" ? "green" : m.type === "PRODUCTION" ? "blue" : "amber"}>
                      {m.type.replace(/_/g, " ")}
                    </Badge>
                  </Td>
                  <Td right className={m.qty < 0 ? "text-burnt" : "text-agave-deep"}>
                    {m.qty > 0 ? `+${num(m.qty)}` : num(m.qty)}
                  </Td>
                  <Td>{m.reference || "—"}</Td>
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
