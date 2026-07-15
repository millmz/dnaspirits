import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, currentPeriod } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { createDepletion, deleteDepletion, importDepletions } from "./actions";

export default async function DepletionsPage({
  searchParams,
}: {
  searchParams: Promise<{ imported?: string; skipped?: string; err?: string }>;
}) {
  await requireUser();
  const { imported, skipped, err } = await searchParams;

  const [depletions, distributors, products] = await Promise.all([
    db.depletion.findMany({
      orderBy: [{ period: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: { distributor: true, product: true },
    }),
    db.distributor.findMany({ orderBy: { name: "asc" } }),
    db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
  ]);

  // summary: cases by period (last 6 periods present in data)
  const byPeriod = new Map<string, number>();
  const all = await db.depletion.groupBy({ by: ["period"], _sum: { cases: true } });
  for (const row of all) byPeriod.set(row.period, row._sum.cases ?? 0);
  const summary = [...byPeriod.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);

  return (
    <div>
      <PageHeader
        title="Depletions"
        subtitle="Cases your distributors sold through to retail accounts — the number that actually grows the brand"
      />

      {imported !== undefined && (
        <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Imported {imported} depletion record{imported === "1" ? "" : "s"}.
          {skipped && (
            <div className="mt-1 text-amber-700">Skipped rows: {skipped}</div>
          )}
        </div>
      )}
      {err && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Monthly totals">
            {summary.length === 0 ? (
              <EmptyState>No depletion data yet.</EmptyState>
            ) : (
              <Table headers={["Month", "Total cases"]} align={["left", "right"]}>
                {summary.map(([period, cases]) => (
                  <tr key={period}>
                    <Td>{period}</Td>
                    <Td right>{num(Math.round(cases * 10) / 10)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Recent records">
            {depletions.length === 0 ? (
              <EmptyState>Import a distributor report or add records manually.</EmptyState>
            ) : (
              <Table
                headers={["Period", "Distributor", "Product", "Account", "Cases", "Source", ""]}
                align={["left", "left", "left", "left", "right", "left", "left"]}
              >
                {depletions.map((d) => (
                  <tr key={d.id}>
                    <Td>{d.period}</Td>
                    <Td>{d.distributor.name}</Td>
                    <Td className="text-xs">{d.product.sku}</Td>
                    <Td>{d.accountName || "—"}</Td>
                    <Td right>{num(d.cases)}</Td>
                    <Td>{d.source === "IMPORT" ? <Badge tone="blue">Import</Badge> : <Badge>Manual</Badge>}</Td>
                    <Td>
                      <form action={deleteDepletion}>
                        <input type="hidden" name="id" value={d.id} />
                        <button className="text-xs text-stone-400 hover:text-red-600">Delete</button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Import CSV report">
            <form action={importDepletions} className="space-y-3">
              <Field label="Depletion report (.csv)">
                <input name="file" type="file" accept=".csv,text/csv" required className={inputCls} />
              </Field>
              <button className={btnCls}>Import</button>
              <div className="text-xs leading-relaxed text-stone-500">
                <p className="font-medium text-stone-600">Expected columns (flexible names):</p>
                <p className="mt-1 font-mono">distributor, sku, period, cases</p>
                <p className="mt-1">
                  Optional: <span className="font-mono">account, account_type</span> (on/off premise).
                  Period accepts <span className="font-mono">2026-07</span>, <span className="font-mono">2026/07/15</span>, etc.
                  Distributor and SKU must already exist in the system; unmatched rows are skipped and reported.
                </p>
              </div>
            </form>
          </Card>

          {distributors.length > 0 && products.length > 0 && (
            <Card title="Add manually">
              <form action={createDepletion} className="space-y-3">
                <Field label="Distributor">
                  <select name="distributorId" className={inputCls}>
                    {distributors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="Product">
                  <select name="productId" className={inputCls}>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Period (YYYY-MM)">
                    <input name="period" defaultValue={currentPeriod()} required className={inputCls} />
                  </Field>
                  <Field label="Cases">
                    <input name="cases" required placeholder="12" className={inputCls} />
                  </Field>
                </div>
                <Field label="Account (optional)">
                  <input name="accountName" placeholder="Total Wine — Austin" className={inputCls} />
                </Field>
                <Field label="Account type">
                  <select name="accountType" className={inputCls}>
                    <option value="UNKNOWN">Unknown</option>
                    <option value="ON_PREMISE">On-premise (bar/restaurant)</option>
                    <option value="OFF_PREMISE">Off-premise (retail)</option>
                  </select>
                </Field>
                <button className={btnCls}>Add record</button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
