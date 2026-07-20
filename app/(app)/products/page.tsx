import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { caseCostFromBom } from "@/lib/bom-cost";
import { PageHeader, Card, Table, Td, Badge, TierBadge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { createProduct, updateProduct, addBomItem, removeBomItem } from "./actions";
import { SubmitButton } from "@/components/submit-button";

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
        subtitle="Your expressions — builds, costs, and pricing."
      />

      <Card title="Catalog">
        <Table
          headers={["SKU", "Product", "Tier", "Size", "Btl/Case", "Cases/Pallet", "COGS /unit", "COGS /case", "FOB /case", "Margin", "Status"]}
          align={["left", "left", "left", "left", "right", "right", "right", "right", "right", "right", "left"]}
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
                <Td right>{p.casesPerPallet}</Td>
                <Td right>{money(Math.round(p.caseCostCents / p.bottlesPerCase))}</Td>
                <Td right>
                  {money(p.caseCostCents)}
                  {p.bomItems.length > 0 && <Badge tone="green">BOM</Badge>}
                </Td>
                <Td right>{money(p.exWorksCents)}</Td>
                <Td right>{margin}%</Td>
                <Td>{p.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-3 text-xs text-slate/70">
          A <Badge tone="green">BOM</Badge> tag means COGS is calculated automatically from components below —
          it updates when component costs change (e.g. on PO receipt). Completed production runs keep the
          cost they were bottled at, so history is never rewritten.
        </p>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {products.filter((p) => p.active).map((p) => {
          const componentsCase = caseCostFromBom(p.bomItems, p.bottlesPerCase);
          const caseCost = caseCostFromBom(p.bomItems, p.bottlesPerCase, p.laborPerBottleCents);
          return (
            <Card key={p.id} title={`BOM — ${p.name}`}>
              {p.bomItems.length === 0 ? (
                <EmptyState>No components mapped yet.</EmptyState>
              ) : (
                <>
                  <Table headers={["Component", "Qty", "Per", "Cost/btl", ""]} align={["left", "right", "left", "right", "left"]}>
                    {p.bomItems.map((b) => (
                      <tr key={b.id}>
                        <Td>{b.component.name}</Td>
                        <Td right>{b.qty}</Td>
                        <Td>{b.per === "CASE" ? "per case" : "per bottle"}</Td>
                        <Td right>
                          {money(
                            Math.round(
                              b.per === "CASE"
                                ? (b.qty * b.component.unitCostCents) / p.bottlesPerCase
                                : b.qty * b.component.unitCostCents
                            )
                          )}
                        </Td>
                        <Td>
                          <form action={removeBomItem}>
                            <input type="hidden" name="id" value={b.id} />
                            <button className="px-1 py-1.5 text-xs text-slate/50 transition-colors hover:text-burnt">Remove</button>
                          </form>
                        </Td>
                      </tr>
                    ))}
                  </Table>
                  <div className="mt-2 space-y-1 border-t border-ink/10 pt-2 text-sm">
                    <div className="flex justify-between text-xs text-slate">
                      <span>Components {money(Math.round(componentsCase / p.bottlesPerCase))}/btl · labor &amp; overhead {money(p.laborPerBottleCents)}/btl</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="brand-heading text-xs text-slate">COGS (BOM + labor)</span>
                      <span className="font-medium">
                        {money(Math.round(caseCost / p.bottlesPerCase))} /unit · {money(caseCost)} /case
                      </span>
                    </div>
                  </div>
                </>
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
                <SubmitButton>Add</SubmitButton>
              </form>
            </Card>
          );
        })}

        <Card title="Add product" collapsible>
          <form action={createProduct} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU">
                <input name="sku" required placeholder="DN-CRISTALINO-700" className={inputCls} />
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
              <input name="name" required placeholder="De Nada Cristalino 700ml" className={inputCls} />
            </Field>
            <div className="grid grid-cols-4 gap-3">
              <Field label="Size (ml)">
                <input name="sizeMl" type="number" defaultValue={700} className={inputCls} />
              </Field>
              <Field label="ABV %">
                <input name="abv" type="number" step="0.1" defaultValue={40} className={inputCls} />
              </Field>
              <Field label="Btl/case">
                <input name="bottlesPerCase" type="number" defaultValue={6} className={inputCls} />
              </Field>
              <Field label="Cases/pallet">
                <input name="casesPerPallet" type="number" defaultValue={140} className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Labor & overhead /bottle ($)">
                <input name="laborPerBottle" placeholder="1.00" className={inputCls} />
              </Field>
              <Field label="Case COGS ($ — auto once a BOM exists)">
                <input name="caseCost" placeholder="72.12" className={inputCls} />
              </Field>
              <Field label="FOB price /case ($)">
                <input name="exWorks" placeholder="114.36" className={inputCls} />
              </Field>
            </div>
            <SubmitButton>Add product</SubmitButton>
          </form>
        </Card>

        <Card title="Edit pricing & status">
          <div className="space-y-4">
            {products.map((p) => {
              const hasBom = p.bomItems.length > 0;
              return (
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
                  <Field label="Labor/btl ($)" className="w-24">
                    <input
                      name="laborPerBottle"
                      defaultValue={(p.laborPerBottleCents / 100).toFixed(2)}
                      className={inputCls}
                    />
                  </Field>
                  <Field label={hasBom ? "COGS (auto)" : "COGS ($)"} className="w-24">
                    <input
                      name="caseCost"
                      defaultValue={(p.caseCostCents / 100).toFixed(2)}
                      disabled={hasBom}
                      title={hasBom ? "Derived from the BOM + labor — edit component costs or labor instead" : undefined}
                      className={`${inputCls} ${hasBom ? "opacity-50" : ""}`}
                    />
                  </Field>
                  <Field label="FOB ($)" className="w-24">
                    <input name="exWorks" defaultValue={(p.exWorksCents / 100).toFixed(2)} className={inputCls} />
                  </Field>
                  <label className="flex items-center gap-2 pb-2 text-sm text-slate">
                    <input type="checkbox" name="active" defaultChecked={p.active} /> Active
                  </label>
                  <SubmitButton>Save</SubmitButton>
                </form>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
