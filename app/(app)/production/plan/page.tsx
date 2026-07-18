import Link from "next/link";
import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, money } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls, Callout, EmptyState } from "@/components/ui";
import { computeShortfalls, createShortfallPO } from "./actions";

/**
 * Run planner (MRP-lite): pick a product and a case target, see exactly
 * which dry goods are covered and which need ordering — with a one-click
 * draft PO per supplier for the gaps.
 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; cases?: string; err?: string }>;
}) {
  await requireOps();
  const { product: productId, cases: casesRaw, err } = await searchParams;
  const cases = Math.max(0, parseInt(casesRaw ?? "0", 10) || 0);
  const products = await db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } });
  const selected = productId ? products.find((p) => p.id === productId) : null;
  const shortfalls = selected && cases > 0 ? await computeShortfalls(selected.id, cases) : [];
  const gaps = shortfalls.filter((s) => s.short > 0);
  const suppliers = [...new Map(gaps.map((s) => [s.supplierId, s.supplierName])).entries()];
  const maxLead = gaps.reduce((a, s) => Math.max(a, s.leadTimeDays), 0);

  return (
    <div>
      <PageHeader
        label="Supply Chain · MX"
        title="Run Planner"
        subtitle="Check dry-goods coverage for a production run before committing to it — and order the gaps in one click."
      />
      <Link href="/production" className="brand-heading mb-4 inline-block text-sm text-agave hover:underline">
        ← Back to production
      </Link>

      {err && <div className="mb-4"><Callout tone="amber">{err}</Callout></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Plan a run">
          <form method="get" className="space-y-3">
            <Field label="Product">
              <select name="product" defaultValue={selected?.id ?? ""} required className={inputCls}>
                <option value="" disabled>Choose a SKU…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Cases to produce">
              <input name="cases" type="number" min={1} defaultValue={cases || ""} required className={inputCls} />
            </Field>
            <button className={btnCls}>Check coverage</button>
          </form>
          {selected && cases > 0 && (
            <p className="mt-3 text-xs text-slate/70">
              {num(cases)} cases = {num(cases * selected.bottlesPerCase)} bottles of {selected.name}.
              {maxLead > 0 && ` Longest lead time on missing goods: ${maxLead} days.`}
            </p>
          )}
        </Card>

        <div className="lg:col-span-2">
          {!selected || cases <= 0 ? (
            <Card><EmptyState>Pick a product and case count to see the material plan.</EmptyState></Card>
          ) : shortfalls.length === 0 ? (
            <Card><EmptyState>{selected.name} has no BOM yet — add one on Products &amp; BOM.</EmptyState></Card>
          ) : (
            <Card
              title={
                gaps.length === 0
                  ? `Fully covered — you can produce ${num(cases)} cases today`
                  : `${gaps.length} component${gaps.length === 1 ? "" : "s"} need ordering`
              }
            >
              <Table
                headers={["Component", "Supplier", "Needed", "On hand", "Short", ""]}
                align={["left", "left", "right", "right", "right", "left"]}
              >
                {shortfalls.map((s) => (
                  <tr key={s.componentId}>
                    <Td>{s.name}</Td>
                    <Td>{s.supplierName}</Td>
                    <Td right>{num(s.need)} {s.unit}</Td>
                    <Td right>{num(s.onHand)}</Td>
                    <Td right>
                      {s.short > 0 ? (
                        <span className="font-medium text-burnt">{num(s.short)}</span>
                      ) : (
                        <Badge tone="green">OK</Badge>
                      )}
                    </Td>
                    <Td>{s.short > 0 && <span className="text-xs text-slate/60">{s.leadTimeDays}d lead</span>}</Td>
                  </tr>
                ))}
              </Table>
              {suppliers.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {suppliers.map(([sid, name]) => {
                    const total = gaps
                      .filter((g) => g.supplierId === sid)
                      .reduce((a, g) => a + Math.ceil(g.short) * g.unitCostCents, 0);
                    return (
                      <form key={sid || name} action={createShortfallPO}>
                        <input type="hidden" name="productId" value={selected.id} />
                        <input type="hidden" name="cases" value={cases} />
                        <input type="hidden" name="supplierId" value={sid} />
                        <button className={btnCls}>
                          Draft PO — {name} ({money(total)})
                        </button>
                      </form>
                    );
                  })}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
