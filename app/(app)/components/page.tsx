import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { getComponentStock } from "@/lib/inventory";
import { money, num } from "@/lib/format";
import Link from "next/link";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls, btnSecondaryCls, EmptyState, Callout } from "@/components/ui";
import { createComponent, updateComponent, editComponentDetails, toggleComponentActive, adjustComponent, createSupplier, updateSupplier } from "./actions";

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

export default async function ComponentsPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; edit?: string; editSupplier?: string; movements?: string }>;
}) {
  await requireOps();
  const { err, edit, editSupplier, movements: movementsFilter } = await searchParams;
  const [components, retired, suppliers, stock, movements] = await Promise.all([
    db.component.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: { supplier: true },
    }),
    db.component.findMany({ where: { active: false }, orderBy: { name: "asc" } }),
    db.supplier.findMany({ orderBy: { name: "asc" } }),
    getComponentStock(),
    db.componentMovement.findMany({
      where: movementsFilter ? { componentId: movementsFilter } : undefined,
      orderBy: { date: "desc" },
      take: movementsFilter ? 100 : 15,
      include: { component: true },
    }),
  ]);
  const editing = edit ? components.find((c) => c.id === edit) ?? retired.find((c) => c.id === edit) : null;
  const editingSupplier = editSupplier ? suppliers.find((s) => s.id === editSupplier) : null;
  const movementComponent = movementsFilter ? [...components, ...retired].find((c) => c.id === movementsFilter) : null;

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

      {err && (
        <div className="mb-4">
          <Callout tone="red">{err}</Callout>
        </div>
      )}

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
            headers={["Component", "Category", "Supplier", "Unit cost", "Lead time", "On hand", "Reorder at", "Status", ""]}
            align={["left", "left", "left", "right", "right", "right", "right", "left", "left"]}
          >
            {components.map((c) => {
              const onHand = stock.get(c.id) ?? 0;
              const isLow = c.reorderPoint > 0 && onHand < c.reorderPoint;
              const formId = `comp-${c.id}`;
              return (
                <tr key={c.id}>
                  <Td className="font-medium">
                    <form id={formId} action={updateComponent}>
                      <input type="hidden" name="id" value={c.id} />
                    </form>
                    <Link href={`/components?edit=${c.id}`} className="hover:underline">{c.name}</Link>
                  </Td>
                  <Td><Badge>{catLabel(c.category)}</Badge></Td>
                  <Td>{c.supplier?.name ?? "—"}</Td>
                  <Td right>
                    <input
                      name="unitCost"
                      form={formId}
                      defaultValue={(c.unitCostCents / 100).toFixed(2)}
                      className="w-20 rounded border border-ink/15 bg-white px-1.5 py-0.5 text-right text-sm"
                    />
                  </Td>
                  <Td right>
                    <input
                      name="leadTimeDays"
                      form={formId}
                      type="number"
                      defaultValue={c.leadTimeDays}
                      className="w-16 rounded border border-ink/15 bg-white px-1.5 py-0.5 text-right text-sm"
                    />
                  </Td>
                  <Td right className="font-medium">{num(Math.round(onHand * 100) / 100)} {c.unit}</Td>
                  <Td right>
                    <input
                      name="reorderPoint"
                      form={formId}
                      defaultValue={c.reorderPoint > 0 ? c.reorderPoint : ""}
                      placeholder="—"
                      className="w-20 rounded border border-ink/15 bg-white px-1.5 py-0.5 text-right text-sm"
                    />
                  </Td>
                  <Td>{isLow ? <Badge tone="red">Reorder</Badge> : <Badge tone="green">OK</Badge>}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <button form={formId} className="text-xs font-medium text-agave-deep hover:underline">
                        Save
                      </button>
                      <Link href={`/components?movements=${c.id}`} className="text-xs text-slate/60 hover:underline">
                        History
                      </Link>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
        <p className="mt-3 text-xs text-slate/70">
          Unit cost, lead time and reorder point are editable in place — cost changes update product COGS
          automatically through the BOMs. Click a component's name to edit its details or retire it;
          “History” shows its full movement ledger.
        </p>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {editing ? (
          <Card title={`Edit ${editing.name}`}>
            <form action={editComponentDetails} className="space-y-3">
              <input type="hidden" name="id" value={editing.id} />
              <Field label="Name">
                <input name="name" required defaultValue={editing.name} className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <select name="category" defaultValue={editing.category} className={inputCls}>
                    {CATEGORIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Unit">
                  <select name="unit" defaultValue={editing.unit} className={inputCls}>
                    <option value="pcs">pieces</option>
                    <option value="liters">liters</option>
                  </select>
                </Field>
              </div>
              <Field label="Supplier">
                <select name="supplierId" defaultValue={editing.supplierId ?? ""} className={inputCls}>
                  <option value="">— none —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Notes">
                <input name="notes" defaultValue={editing.notes} className={inputCls} />
              </Field>
              <div className="flex items-center gap-3">
                <button className={btnCls}>Save changes</button>
                <Link href="/components" className={btnSecondaryCls}>Cancel</Link>
              </div>
            </form>
            <form action={toggleComponentActive} className="mt-4 border-t border-ink/10 pt-3">
              <input type="hidden" name="id" value={editing.id} />
              <button className="text-xs text-slate/60 hover:text-burnt">
                {editing.active ? "Retire this component (hides it from forms; history kept)" : "Reactivate this component"}
              </button>
            </form>
          </Card>
        ) : (
        <Card title="Add component">
          <form action={createComponent} className="space-y-3">
            <Field label="Name">
              <input name="name" required placeholder="Shipper Box — Añejo 700ml" className={inputCls} />
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
        )}

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

        {editingSupplier ? (
          <Card title={`Edit ${editingSupplier.name}`}>
            <form action={updateSupplier} className="space-y-3">
              <input type="hidden" name="id" value={editingSupplier.id} />
              <Field label="Name">
                <input name="name" required defaultValue={editingSupplier.name} className={inputCls} />
              </Field>
              <Field label="Location">
                <input name="location" defaultValue={editingSupplier.location} className={inputCls} />
              </Field>
              <Field label="Contact">
                <input name="contactName" defaultValue={editingSupplier.contactName} className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email">
                  <input name="email" type="email" defaultValue={editingSupplier.email} className={inputCls} />
                </Field>
                <Field label="Phone">
                  <input name="phone" defaultValue={editingSupplier.phone} className={inputCls} />
                </Field>
              </div>
              <div className="flex items-center gap-3">
                <button className={btnCls}>Save supplier</button>
                <Link href="/components" className={btnSecondaryCls}>Cancel</Link>
              </div>
            </form>
          </Card>
        ) : (
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
          <p className="mt-3 text-xs text-slate/70">
            Edit an existing supplier:{" "}
            {suppliers.map((s, i) => (
              <span key={s.id}>
                {i > 0 && " · "}
                <Link href={`/components?editSupplier=${s.id}`} className="text-agave-deep hover:underline">{s.name}</Link>
              </span>
            ))}
          </p>
        </Card>
        )}
      </div>

      <div className="mt-6">
        <Card title={movementComponent ? `Movement history — ${movementComponent.name}` : "Recent movements"}>
          {movementComponent && (
            <Link href="/components" className="brand-heading mb-3 inline-block text-xs text-agave hover:underline">
              ← Back to recent movements
            </Link>
          )}
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
