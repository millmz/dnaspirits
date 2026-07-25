import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { getInventoryPipeline } from "@/lib/pipeline";
import { num } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, TierBadge, EmptyState } from "@/components/ui";
import { DropZone } from "@/components/drop-zone";

const cs = (v: number) => num(Math.round(v * 10) / 10);

export default async function PositionPage() {
  await requireOps();
  const [pipeline, importer] = await Promise.all([
    getInventoryPipeline(),
    db.importer.findFirst({ orderBy: { name: "asc" } }),
  ]);
  const { rows, distributorHoldings, lsiAsOf, distAsOf, totals } = pipeline;
  const lsiName = importer?.name ?? "LSI";

  // roll the per-distributor holdings up to one line per distributor
  const byDistributor = new Map<
    string,
    { distributor: string; market: string; period: string; cases: number; skus: Set<string> }
  >();
  for (const h of distributorHoldings) {
    const cur = byDistributor.get(h.distributorId);
    if (cur) {
      cur.cases += h.cases;
      cur.skus.add(h.sku);
      if (h.period > cur.period) cur.period = h.period;
    } else {
      byDistributor.set(h.distributorId, {
        distributor: h.distributor,
        market: h.market,
        period: h.period,
        cases: h.cases,
        skus: new Set([h.sku]),
      });
    }
  }
  const distributorRows = [...byDistributor.values()].sort((a, b) => b.cases - a.cases);

  return (
    <div>
      <PageHeader
        label="Market · United States"
        title="Inventory Position"
        subtitle="Every case of De Nada, in one view — ours, LSI's, and the distributors'."
      />

      {/* The three tiers at a glance */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="brand-heading text-[11px] tracking-widest text-slate">Tier 1 · Our stock</div>
          <div className="mt-1 text-3xl font-medium text-ink">{cs(totals.ownCases)}</div>
          <div className="text-xs text-slate/70">cases bottled in our warehouses</div>
        </Card>
        <Card>
          <div className="brand-heading text-[11px] tracking-widest text-slate">Tier 2 · At {lsiName}</div>
          <div className="mt-1 text-3xl font-medium text-ink">{cs(totals.lsiCases)}</div>
          <div className="text-xs text-slate/70">
            cases at the importer{lsiAsOf ? ` · reported ${lsiAsOf}` : " · no report yet"}
          </div>
        </Card>
        <Card>
          <div className="brand-heading text-[11px] tracking-widest text-slate">Tier 3 · At distributors</div>
          <div className="mt-1 text-3xl font-medium text-ink">{cs(totals.distCases)}</div>
          <div className="text-xs text-slate/70">
            cases in the field{distAsOf ? ` · reported ${distAsOf}` : " · no report yet"}
          </div>
        </Card>
      </div>

      {/* Full pipeline per SKU */}
      <Card title="Pipeline by product" className="mt-6">
        {rows.length === 0 ? (
          <EmptyState>No products yet.</EmptyState>
        ) : (
          <Table
            headers={[
              "SKU",
              "Tier",
              "Ours",
              `At ${lsiName}`,
              "At distributors",
              "Total pipeline",
              "Velocity (cs/mo)",
              "Weeks in market",
              "Signal",
            ]}
            align={["left", "left", "right", "right", "right", "right", "right", "right", "left"]}
          >
            {rows.map((r) => (
              <tr key={r.productId}>
                <Td>
                  <span className="font-mono text-xs">{r.sku}</span>
                </Td>
                <Td><TierBadge tier={r.tier} /></Td>
                <Td right>
                  {cs(r.ownCases)}
                  <span className="ml-1 text-[10px] text-slate/60">({num(r.ownBottles)} btl)</span>
                </Td>
                <Td right>{cs(r.lsiCases)}</Td>
                <Td right>{cs(r.distCases)}</Td>
                <Td right className="font-medium">{cs(r.totalCases)}</Td>
                <Td right>{r.velocityCasesPerMonth > 0 ? cs(r.velocityCasesPerMonth) : "—"}</Td>
                <Td right>{r.weeksOfSupply === null ? "—" : num(Math.round(r.weeksOfSupply))}</Td>
                <Td>
                  {r.weeksOfSupply === null ? (
                    <Badge>Need data</Badge>
                  ) : r.weeksOfSupply < 8 ? (
                    <Badge tone="red">Ship more</Badge>
                  ) : r.weeksOfSupply < 14 ? (
                    <Badge tone="amber">Watch</Badge>
                  ) : (
                    <Badge tone="green">Healthy</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-slate/70">
          All case counts are physical cases — a real sellable case, the unit De Nada tracks.
          &ldquo;Weeks in market&rdquo; is {lsiName} + distributor stock against the 3-month average
          depletion rate — our own warehouse stock isn&apos;t in the market yet, so it stays out of
          that clock.
        </p>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Who holds what — by distributor">
            {distributorRows.length === 0 ? (
              <EmptyState>
                No distributor stock on file yet — drop the LSI Depletions &amp; Shipments workbook on
                the right.
              </EmptyState>
            ) : (
              <Table
                headers={["Distributor", "Market", "SKUs", "Cases", "As of"]}
                align={["left", "left", "left", "right", "left"]}
              >
                {distributorRows.map((d) => (
                  <tr key={d.distributor}>
                    <Td className="font-medium">{d.distributor}</Td>
                    <Td>{d.market || "—"}</Td>
                    <Td className="font-mono text-xs">{[...d.skus].join(", ")}</Td>
                    <Td right>{cs(d.cases)}</Td>
                    <Td>{d.period}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <Card title="Update with the latest report">
          <DropZone
            hint="Drop the LSI workbook or commercial report here"
            importerId={importer?.id}
            accept=".xlsx,.xls,.csv"
          />
          <p className="mt-3 text-xs leading-relaxed text-slate/70">
            The LSI Depletions &amp; Shipments workbook refreshes tiers 2 and 3. It stages in the
            Review Inbox first — approve it there and this page updates. Re-uploading a month
            safely replaces it.
          </p>
        </Card>
      </div>
    </div>
  );
}
