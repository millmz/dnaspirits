import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMarketPosition } from "@/lib/market";
import { num, currentPeriod } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, TierBadge, Field, inputCls, btnCls, EmptyState, Callout } from "@/components/ui";
import { createChannelStock, deleteChannelStock, importChannelStock, importLsiInventory } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export default async function ChannelPage({
  searchParams,
}: {
  searchParams: Promise<{
    imported?: string;
    skipped?: string;
    err?: string;
    lsiPeriod?: string;
    lsiImporter?: string;
    lsiDist?: string;
  }>;
}) {
  await requireOps();
  const { imported, skipped, err, lsiPeriod, lsiImporter, lsiDist } = await searchParams;

  const [position, stocks, importers, distributors, products] = await Promise.all([
    getMarketPosition(),
    db.channelStock.findMany({
      orderBy: [{ period: "desc" }, { createdAt: "desc" }],
      take: 60,
      include: { importer: true, distributor: true, product: true },
    }),
    db.importer.findMany({ orderBy: { name: "asc" } }),
    db.distributor.findMany({ orderBy: { name: "asc" }, include: { importer: true } }),
    db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader
        label="Market · United States"
        title="Channel Inventory"
        subtitle="Stock sitting with your importer and each distributor, from their reports. Weeks of supply is your restock clock: channel stock ÷ depletion velocity."
      />

      {lsiPeriod && (
        <Callout tone="green">
          Imported the {lsiPeriod} LSI inventory report: importer stock for {lsiImporter} product
          {lsiImporter === "1" ? "" : "s"} plus {lsiDist} distributor stock position
          {lsiDist === "1" ? "" : "s"} (physical cases converted to 9L). Re-uploading a report
          for the same month replaces it.
          {skipped && <div className="mt-1 text-burnt">Notes: {skipped}</div>}
        </Callout>
      )}
      {imported !== undefined && (
        <Callout tone="green">
          Imported {imported} stock record{imported === "1" ? "" : "s"}.
          {skipped && <div className="mt-1 text-burnt">Skipped rows: {skipped}</div>}
        </Callout>
      )}
      {err && <Callout tone="red">{err}</Callout>}

      <Card title="Market position">
        <Table
          headers={["SKU", "Product", "Tier", "Cases in channel", "Velocity (cases/mo)", "Weeks of supply", "Signal"]}
          align={["left", "left", "left", "right", "right", "right", "left"]}
        >
          {position.map((p) => (
            <tr key={p.productId}>
              <Td><span className="font-mono text-xs">{p.sku}</span></Td>
              <Td>{p.name}</Td>
              <Td><TierBadge tier={p.tier} /></Td>
              <Td right>{num(Math.round(p.channelCases))}</Td>
              <Td right>{p.velocityCasesPerMonth > 0 ? num(Math.round(p.velocityCasesPerMonth * 10) / 10) : "—"}</Td>
              <Td right className="font-medium">
                {p.weeksOfSupply === null ? "—" : num(Math.round(p.weeksOfSupply))}
              </Td>
              <Td>
                {p.weeksOfSupply === null ? (
                  <Badge>Need data</Badge>
                ) : p.weeksOfSupply < 8 ? (
                  <Badge tone="red">Restock soon</Badge>
                ) : p.weeksOfSupply < 14 ? (
                  <Badge tone="amber">Watch</Badge>
                ) : (
                  <Badge tone="green">Healthy</Badge>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-slate/70">
          Channel stock uses each holder&apos;s most recent report. Velocity is the 3-month average of depletions.
        </p>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Recent stock reports">
            {stocks.length === 0 ? (
              <EmptyState>No channel stock yet — import your importer&apos;s report or add a record.</EmptyState>
            ) : (
              <Table headers={["Period", "Holder", "Product", "Cases", "Source", ""]} align={["left", "left", "left", "right", "left", "left"]}>
                {stocks.map((s) => (
                  <tr key={s.id}>
                    <Td>{s.period}</Td>
                    <Td>
                      {s.holderType === "IMPORTER"
                        ? `${s.importer?.name} (importer)`
                        : s.distributor?.name}
                    </Td>
                    <Td className="text-xs">{s.product.sku}</Td>
                    <Td right>{num(s.cases)}</Td>
                    <Td>
                      {s.source === "REPORT" ? <Badge tone="green">Report</Badge>
                        : s.source === "IMPORT" ? <Badge tone="blue">CSV</Badge>
                        : <Badge>Manual</Badge>}
                    </Td>
                    <Td>
                      <form action={deleteChannelStock}>
                        <input type="hidden" name="id" value={s.id} />
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
          <Card title="Upload LSI report (.xlsx)">
            <form action={importLsiInventory} className="space-y-3">
              <Field label="Importer">
                <select name="importerId" className={inputCls}>
                  {importers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </Field>
              <Field label="Depletions & Shipments workbook">
                <input name="file" type="file" accept=".xlsx,.xls" required className={inputCls} />
              </Field>
              <Field label="Report month (auto-detected from filename when possible)">
                <input name="period" placeholder="YYYY-MM" className={inputCls} />
              </Field>
              <SubmitButton>Import inventory</SubmitButton>
              <div className="text-xs leading-relaxed text-slate/80">
                Reads the &ldquo;LSI Inventory&rdquo; and &ldquo;Distributor Inventory&rdquo; sheets as channel
                stock (physical cases → 9L). Distributors auto-create with their real names.
                Depletion sheets are skipped — the commercial report is the depletion source.
              </div>
            </form>
          </Card>

          <Card title="Import stock CSV">
            <form action={importChannelStock} className="space-y-3">
              <Field label="Report file (.csv)">
                <input name="file" type="file" accept=".csv,text/csv" required className={inputCls} />
              </Field>
              <SubmitButton>Import</SubmitButton>
              <div className="text-xs leading-relaxed text-slate/80">
                <p className="brand-heading font-medium text-slate">Expected columns:</p>
                <p className="mt-1 font-mono">holder, sku, period, cases</p>
                <p className="mt-1">
                  &ldquo;holder&rdquo; is your importer&apos;s name or a distributor&apos;s name (must exist under Partners).
                </p>
              </div>
            </form>
          </Card>

          <Card title="Add record manually" collapsible>
            <form action={createChannelStock} className="space-y-3">
              <Field label="Holder">
                <select name="holder" className={inputCls}>
                  {importers.map((i) => (
                    <option key={i.id} value={`imp:${i.id}`}>{i.name} (importer)</option>
                  ))}
                  {distributors.map((d) => (
                    <option key={d.id} value={`dist:${d.id}`}>{d.name}{d.market ? ` (${d.market})` : ""}</option>
                  ))}
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
                <Field label="Cases on hand (9L equivalents)">
                  <input name="cases" required placeholder="120" className={inputCls} />
                </Field>
              </div>
              <SubmitButton>Add record</SubmitButton>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
