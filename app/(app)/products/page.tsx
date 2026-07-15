import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, TierBadge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { createProduct, updateProduct, addBomItem, removeBomItem } from "./actions";

export default async function ProductsPage() {
  await requireOps();
  const [products, components] = await Promise.all([
    db.product.findMany({
      orderBy: { sku: "asc" },
      include: { bomItems: { include: { component: true } } },
    }),
    db.component.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader
        label="Supply Chain · Mexico"
        title="Products & BOM"
        subtitle="Your expressions and what goes into each one. The bill of materials drives automatic dry-goods consumption when a production run completes."
      />

      <Card title="Catalog">
        <Table
          headers={["SKU", "Product", "Tier", "Size", "Btl/Case", "Case COGS", "Ex-works /case", "Margin", "Status"]}
          align={["left", "left", "left", "left", "right", "right", "right", "right", "left"]}
        >
          {products.map((p) => {
            const margin =
              p.exWorksCents > 0
                ? Math.round(((p.exWorksCents - p.caseCostCents) / p.exWorksCents) * 100)
                : 0;
            return (
              <tr key={p.id}>
                <Td><span className="font-mono text-xs">{p.sku}</span></Td>
                <Td>{p.name}</Td>
                <Td><TierBadge tier={p.tier} /></Td>
                <Td>{p.sizeMl}ml · {p.abv}%</Td>
                <Td right>{p.bottlesPerCase}</Td>
                <Td right>{money(p.caseCostCents)}</Td>
                <Td right>{money(p.exWorksCents)}</Td>
                <Td right>{margin}%</Td>
                <Td>{p.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {products.filter((p) => p.active).map((p) => (
          <Card key={p.id} title={`BOM — ${p.name}`}>
            {p.bomItems.length === 0 ? (
              <EmptyState>No components mapped yet.</EmptyState>
            ) : (
              <Table headers={["Component", "Qty", "Per", ""]} align={["left", "right", "left", "left"]}>
                {p.bomItems.map((b) => (
                  <tr key={b.id}>
                    <Td>{b.component.name}</Td>
                    <Td right>{b.qty}</Td>
                    <Td>{b.per === "CASE" ? "per case" : "per bottle"}</Td>
                    <Td>
                      <form action={removeBomItem}>
                        <input type="hidden" name="id" value={b.id} />
                        <button className="text-xs text-slate/60 hover:text-burnt">Remove</button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            <form action={addBomItem} className="mt-4 grid grid-cols-[1fr_70px_110px_auto] items-end gap-2">
              <input type="hidden" name="productId" value={p.id} />
              <Field label="Component">
                <select name="componentId" className={inputCls}>
                  {components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Qty">
                <input name="qty" defaultValue="1" className={inputCls} />
              </Field>
              <Field label="Per">
                <select name="per" className={inputCls}>
                  <option value="BOTTLE">per bottle</option>
                  <option value="CASE">per case</option>
                </select>
              </Field>
              <button className={btnCls}>Add</button>
            </form>
          </Card>
        ))}

        <Card title="Add product">
          <form action={createProduct} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU">
                <input name="sku" required placeholder="DN-CRISTALINO-750" className={inputCls} />
              </Field>
              <Field label="Tier">
                <select name="tier" className={inputCls}>
                  <option value="BLANCO">Blanco</option>
                  <option value="REPOSADO">Reposado</option>
                  <option value="ANEJO">Añejo</option>
                  <option value="OTHER">Other</option>
                </select>
              </Field>
            </div>
            <Field label="Name">
              <input name="name" required placeholder="De Nada Cristalino 750ml" className={inputCls} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Size (ml)">
                <input name="sizeMl" type="number" defaultValue={750} className={inputCls} />
              </Field>
              <Field label="ABV %">
                <input name="abv" type="number" step="0.1" defaultValue={40} className={inputCls} />
              </Field>
              <Field label="Bottles/case">
                <input name="bottlesPerCase" type="number" defaultValue={6} className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Case COGS ($)">
                <input name="caseCost" placeholder="90.00" className={inputCls} />
              </Field>
              <Field label="Ex-works price /case ($)">
                <input name="exWorks" placeholder="180.00" className={inputCls} />
              </Field>
            </div>
            <button className={btnCls}>Add product</button>
          </form>
        </Card>

        <Card title="Edit pricing & status">
          <div className="space-y-4">
            {products.map((p) => (
              <form
                key={p.id}
                action={updateProduct}
                className="flex flex-wrap items-end gap-3 border-b border-ink/8 pb-4 last:border-0 last:pb-0"
              >
                <input type="hidden" name="id" value={p.id} />
                <div className="w-36 pt-2 font-mono text-xs text-slate">{p.sku}</div>
                <Field label="Name" className="min-w-48 flex-1">
                  <input name="name" defaultValue={p.name} className={inputCls} />
                </Field>
                <Field label="COGS ($)" className="w-24">
                  <input name="caseCost" defaultValue={(p.caseCostCents / 100).toFixed(2)} className={inputCls} />
                </Field>
                <Field label="Ex-works ($)" className="w-24">
                  <input name="exWorks" defaultValue={(p.exWorksCents / 100).toFixed(2)} className={inputCls} />
                </Field>
                <label className="flex items-center gap-2 pb-2 text-sm text-slate">
                  <input type="checkbox" name="active" defaultChecked={p.active} /> Active
                </label>
                <button className={btnCls}>Save</button>
              </form>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
