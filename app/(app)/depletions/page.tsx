import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, currentPeriod } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, TierBadge, Field, inputCls, btnCls, EmptyState, Callout } from "@/components/ui";
import { createDepletion, deleteDepletion, importDepletions, importCommercialReport } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { DropZone } from "@/components/drop-zone";

const pct = (v: number | null) =>
  v === null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`;

export default async function DepletionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    imported?: string;
    skipped?: string;
    err?: string;
    report?: string;
    months?: string;
    records?: string;
    sku?: string;
    snapshots?: string;
    chains?: string;
  }>;
}) {
  await requireOps();
  const sp = await searchParams;

  const [depletions, distributors, products, importers, latestSnapshot, latestChains] =
    await Promise.all([
      db.depletion.findMany({
        orderBy: [{ period: "desc" }, { createdAt: "desc" }],
        take: 60,
        include: { distributor: true, product: true },
      }),
      db.distributor.findMany({ orderBy: { name: "asc" } }),
      db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
      db.importer.findMany({ orderBy: { name: "asc" } }),
      db.marketSnapshot.findMany({ orderBy: [{ period: "desc" }, { ytdCases: "desc" }] }),
      db.chainVolume.findMany({ orderBy: [{ period: "desc" }, { ytdCases: "desc" }] }),
    ]);

  const snapPeriod = latestSnapshot[0]?.period;
  const snapshots = latestSnapshot.filter((s) => s.period === snapPeriod);
  const chainPeriod = latestChains[0]?.period;
  const chains = latestChains.filter((c) => c.period === chainPeriod).slice(0, 12);

  const byPeriod = await db.depletion.groupBy({ by: ["period"], _sum: { cases: true } });
  const summary = byPeriod
    .map((r) => [r.period, r._sum.cases ?? 0] as const)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6);

  return (
    <div>
      <PageHeader
        label="Market · United States"
        title="Depletions"
        subtitle="Cases sold through to retail — the number that grows the brand."
      />

      {sp.report && (
        <Callout tone="green">
          Imported the {sp.report} commercial report: {sp.records} market-month depletion records
          across {sp.months} months, {sp.sku} per-SKU records, {sp.snapshots} market snapshots,
          and {sp.chains} chain totals. Re-uploading a newer report safely replaces these.
          {sp.skipped && <div className="mt-1 text-burnt">Notes: {sp.skipped}</div>}
        </Callout>
      )}
      {sp.imported !== undefined && (
        <Callout tone="green">
          Imported {sp.imported} depletion record{sp.imported === "1" ? "" : "s"}.
          {sp.skipped && <div className="mt-1 text-burnt">Skipped rows: {sp.skipped}</div>}
        </Callout>
      )}
      {sp.err && <Callout tone="red">{sp.err}</Callout>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {snapshots.length > 0 && (
            <Card title={`YTD by market — from the ${snapPeriod} report`}>
              <Table
                headers={["Market", "YTD cases (9L)", "vs LY", "Accounts", "vs LY", "Velocity"]}
                align={["left", "right", "right", "right", "right", "right"]}
              >
                {snapshots.map((s) => {
                  const volLY =
                    s.ytdCasesLY && s.ytdCasesLY > 0
                      ? (s.ytdCases - s.ytdCasesLY) / s.ytdCasesLY
                      : null;
                  const accLY =
                    s.accountsLY && s.accountsLY > 0
                      ? (s.accounts - s.accountsLY) / s.accountsLY
                      : null;
                  return (
                    <tr key={s.id}>
                      <Td className="font-medium">{s.market}</Td>
                      <Td right>{num(Math.round(s.ytdCases))}</Td>
                      <Td right className={volLY !== null && volLY < 0 ? "text-burnt" : "text-agave-deep"}>
                        {pct(volLY)}
                      </Td>
                      <Td right>{num(s.accounts)}</Td>
                      <Td right className={accLY !== null && accLY < 0 ? "text-burnt" : "text-agave-deep"}>
                        {pct(accLY)}
                      </Td>
                      <Td right>{s.velocity === null ? "—" : (Math.round(s.velocity * 100) / 100).toFixed(2)}</Td>
                    </tr>
                  );
                })}
              </Table>
              <p className="mt-2 text-xs text-slate/70">
                Accounts = distinct retail accounts buying YTD. Velocity = cases per account.
              </p>
            </Card>
          )}

          <Card title="Monthly totals (9L cases)">
            {summary.length === 0 ? (
              <EmptyState>No depletion data yet — upload your commercial report on the right.</EmptyState>
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

          {chains.length > 0 && (
            <Card title={`Top retail chains YTD — from the ${chainPeriod} report`}>
              <Table headers={["Chain", "YTD cases (9L)", "vs LY"]} align={["left", "right", "right"]}>
                {chains.map((c) => {
                  const ly =
                    c.ytdCasesLY && c.ytdCasesLY > 0
                      ? (c.ytdCases - c.ytdCasesLY) / c.ytdCasesLY
                      : null;
                  return (
                    <tr key={c.id}>
                      <Td>{c.chain}</Td>
                      <Td right>{num(Math.round(c.ytdCases))}</Td>
                      <Td right className={ly !== null && ly < 0 ? "text-burnt" : "text-agave-deep"}>
                        {pct(ly)}
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          )}

          <Card title="Recent records">
            {depletions.length === 0 ? (
              <EmptyState>Nothing yet.</EmptyState>
            ) : (
              <Table
                headers={["Period", "Market / Distributor", "Product", "Cases (9L)", "Source", ""]}
                align={["left", "left", "left", "right", "left", "left"]}
              >
                {depletions.map((d) => (
                  <tr key={d.id}>
                    <Td>{d.period}</Td>
                    <Td>{d.distributor.name}</Td>
                    <Td className="text-xs">{d.product ? d.product.sku : "All SKUs"}</Td>
                    <Td right>{num(Math.round(d.cases * 100) / 100)}</Td>
                    <Td>
                      {d.source === "REPORT" ? <Badge tone="green">Report</Badge>
                        : d.source === "IMPORT" ? <Badge tone="blue">CSV</Badge>
                        : <Badge>Manual</Badge>}
                    </Td>
                    <Td>
                      <form action={deleteDepletion}>
                        <input type="hidden" name="id" value={d.id} />
                        <button className="px-1 py-1.5 text-xs text-slate/50 transition-colors hover:text-burnt">Delete</button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Drop the latest report">
            <DropZone
              hint="Drop the commercial report here"
              importerId={importers[0]?.id}
              accept=".xlsx,.xls,.csv"
              compact
            />
            <p className="mt-2 text-xs text-slate/70">
              Stages in the Review Inbox — approve there and this page updates.
            </p>
          </Card>

          <Card title="Upload commercial report (.xlsx)" collapsible>
            <form action={importCommercialReport} className="space-y-3">
              <Field label="Importer">
                <select name="importerId" className={inputCls}>
                  {importers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </Field>
              <Field label="Monthly commercial report">
                <input name="file" type="file" accept=".xlsx,.xls" required className={inputCls} />
              </Field>
              <SubmitButton>Import report</SubmitButton>
              <div className="text-xs leading-relaxed text-slate/80">
                One click imports everything: monthly depletions by market, per-SKU
                velocity, YTD accounts &amp; velocity by market, and top retail chains.
                Markets auto-create as distributor entries. Newer reports replace older
                data for the same months.
              </div>
            </form>
          </Card>

          <Card title="Import CSV (per-account detail)">
            <form action={importDepletions} className="space-y-3">
              <Field label="Depletion CSV">
                <input name="file" type="file" accept=".csv,text/csv" required className={inputCls} />
              </Field>
              <SubmitButton>Import CSV</SubmitButton>
              <div className="text-xs leading-relaxed text-slate/80">
                Columns: <span className="font-mono">distributor, sku, period, cases</span>
                {" "}(+ optional <span className="font-mono">account, account_type</span>).
                Use this for account-level exports (e.g. iDig account detail).
              </div>
            </form>
          </Card>

          {distributors.length > 0 && products.length > 0 && (
            <Card title="Add manually" collapsible>
              <form action={createDepletion} className="space-y-3">
                <Field label="Distributor / market">
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
                  <Field label="Cases (9L)">
                    <input name="cases" required placeholder="12" className={inputCls} />
                  </Field>
                </div>
                <Field label="Account (optional)">
                  <input name="accountName" placeholder="Total Wine — Austin" className={inputCls} />
                </Field>
                <SubmitButton>Add record</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
