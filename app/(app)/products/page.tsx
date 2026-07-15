import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls } from "@/components/ui";
import { createProduct, updateProduct } from "./actions";

export default async function ProductsPage() {
  await requireUser();
  const products = await db.product.findMany({ orderBy: { sku: "asc" } });

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Your SKUs — expressions, sizes, costs, and wholesale pricing"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Catalog" className="lg:col-span-2">
          <Table
            headers={["SKU", "Product", "Size", "Btl/Case", "Case COGS", "Case Price", "Margin", "Status"]}
            align={["left", "left", "left", "right", "right", "right", "right", "left"]}
          >
            {products.map((p) => {
              const margin =
                p.casePriceCents > 0
                  ? Math.round(((p.casePriceCents - p.caseCostCents) / p.casePriceCents) * 100)
                  : 0;
              return (
                <tr key={p.id}>
                  <Td><span className="font-mono text-xs">{p.sku}</span></Td>
                  <Td>{p.name}</Td>
                  <Td>{p.sizeMl}ml · {p.abv}%</Td>
                  <Td right>{p.bottlesPerCase}</Td>
                  <Td right>{money(p.caseCostCents)}</Td>
                  <Td right>{money(p.casePriceCents)}</Td>
                  <Td right>{margin}%</Td>
                  <Td>{p.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card title="Add product">
          <form action={createProduct} className="space-y-3">
            <Field label="SKU (e.g. DN-CRISTALINO-750)">
              <input name="sku" required className={inputCls} />
            </Field>
            <Field label="Name">
              <input name="name" required placeholder="Denada Cristalino 750ml" className={inputCls} />
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
              <Field label="Case price ($)">
                <input name="casePrice" placeholder="180.00" className={inputCls} />
              </Field>
            </div>
            <button className={btnCls}>Add product</button>
          </form>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Edit pricing & status">
          <div className="space-y-4">
            {products.map((p) => (
              <form
                key={p.id}
                action={updateProduct}
                className="flex flex-wrap items-end gap-3 border-b border-stone-100 pb-4 last:border-0 last:pb-0"
              >
                <input type="hidden" name="id" value={p.id} />
                <div className="w-44 pt-2 font-mono text-xs text-stone-500">{p.sku}</div>
                <Field label="Name" className="min-w-56 flex-1">
                  <input name="name" defaultValue={p.name} className={inputCls} />
                </Field>
                <Field label="Case COGS ($)" className="w-32">
                  <input name="caseCost" defaultValue={(p.caseCostCents / 100).toFixed(2)} className={inputCls} />
                </Field>
                <Field label="Case price ($)" className="w-32">
                  <input name="casePrice" defaultValue={(p.casePriceCents / 100).toFixed(2)} className={inputCls} />
                </Field>
                <label className="flex items-center gap-2 pb-2 text-sm text-stone-600">
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
