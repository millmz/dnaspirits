import Link from "next/link";
import { requireOps } from "@/lib/auth";
import { getMonthlyKpis, getAnnualFinancials, ytdComparison, getSkuMix, getMarketOverview, getChainOverview } from "@/lib/kpi";
import { getMarketPosition } from "@/lib/market";
import { money, num } from "@/lib/format";
import { PageHeader, Card, Stat, Table, Td, Badge, TierBadge, EmptyState, Callout } from "@/components/ui";
import { BarChart } from "@/components/charts";

export const dynamic = "force-dynamic";

const growthBadge = (pct: number | null) =>
  pct === null ? (
    <Badge>New</Badge>
  ) : pct >= 0 ? (
    <Badge tone="green">+{num(Math.round(pct))}%</Badge>
  ) : (
    <Badge tone="red">{num(Math.round(pct))}%</Badge>
  );

export default async function ReportsPage() {
  await requireOps();

  const [monthly, annualFin, skuMix, markets, chains, position] = await Promise.all([
    getMonthlyKpis(),
    getAnnualFinancials(),
    getSkuMix(6),
    getMarketOverview(),
    getChainOverview(),
    getMarketPosition(),
  ]);

  const year = new Date().getFullYear();
  const ytd = ytdComparison(monthly, year);
  const last12 = monthly.slice(-12);

  // velocity: average of the 3 most recent months with depletion data
  const withDepletions = monthly.filter((m) => m.depletionCases > 0).slice(-3);
  const velocity =
    withDepletions.length > 0
      ? withDepletions.reduce((a, m) => a + m.depletionCases, 0) / withDepletions.length
      : 0;

  // brand-level weeks of supply: total channel stock ÷ total velocity
  const channelTotal = position.reduce((a, p) => a + p.channelCases, 0);
  const weeksOfSupply = velocity > 0 ? (channelTotal / velocity) * 4.33 : null;

  const thisYear = monthly.filter((m) => m.period.startsWith(`${year}-`));
  const revenueYtd = thisYear.reduce((a, m) => a + m.shipmentRevenueCents, 0);
  const shippedYtd = thisYear.reduce((a, m) => a + m.shipmentCases, 0);

  // annual rollup: ops data from the monthly history, QB financials from
  // getAnnualFinancials (covers both monthly uploads and "YYYY-FY" history)
  const byYear = new Map<
    string,
    { depletions: number; shipped: number; revenue: number; qbIncome: number; qbExpense: number; hasQb: boolean }
  >();
  const yearOf = (y: string) => {
    let r = byYear.get(y);
    if (!r) {
      r = { depletions: 0, shipped: 0, revenue: 0, qbIncome: 0, qbExpense: 0, hasQb: false };
      byYear.set(y, r);
    }
    return r;
  };
  for (const m of monthly) {
    const r = yearOf(m.period.slice(0, 4));
    r.depletions += m.depletionCases;
    r.shipped += m.shipmentCases;
    r.revenue += m.shipmentRevenueCents;
  }
  for (const [y, fin] of annualFin) {
    const r = yearOf(y);
    r.hasQb = true;
    r.qbIncome = fin.income;
    r.qbExpense = fin.expense;
  }
  const years = [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const showAnnual = years.length > 1 || years.some(([, r]) => r.hasQb);

  return (
    <div>
      <PageHeader
        label="Performance"
        title="Reports & KPIs"
        subtitle="The whole business rolled up across every month of data you've uploaded — depletions, shipments, channel stock and financials accumulate here, month over month."
      />

      <div className="-mt-2 mb-5">
        <Link
          href="/investor"
          className="inline-block rounded-md border border-agave px-3 py-1.5 text-sm font-medium text-agave-deep hover:bg-agave/10"
        >
          Investor one-pager →
        </Link>
      </div>

      {monthly.length === 0 ? (
        <Card title="No data yet">
          <EmptyState>
            KPIs build themselves from your monthly uploads. Start with the{" "}
            <Link href="/depletions" className="text-agave-deep underline">commercial report</Link> and the{" "}
            <Link href="/channel" className="text-agave-deep underline">LSI inventory workbook</Link> — each upload adds
            its months to the history, and this page aggregates all of them.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              label={`Depletions · ${year} YTD`}
              value={`${num(Math.round(ytd.ytdCases))} cases`}
              tone="agave"
              hint={
                ytd.growthPct === null
                  ? "9L cases sold to retail"
                  : `${ytd.growthPct >= 0 ? "+" : ""}${num(Math.round(ytd.growthPct))}% vs same months last year`
              }
            />
            <Stat
              label="Depletion velocity"
              value={`${num(Math.round(velocity * 10) / 10)} /mo`}
              hint="Average of the last 3 reported months"
            />
            <Stat
              label="Weeks of supply · channel"
              value={weeksOfSupply === null ? "—" : num(Math.round(weeksOfSupply))}
              tone={weeksOfSupply !== null && weeksOfSupply < 8 ? "reposado" : "ink"}
              hint={`${num(Math.round(channelTotal))} cases in the channel ÷ velocity`}
            />
            <Stat
              label={`Ex-works revenue · ${year} YTD`}
              value={money(revenueYtd)}
              hint={`${num(shippedYtd)} cases invoiced to your importer`}
            />
          </div>

          <Card title="Shipments in vs depletions out (9L cases)">
            <BarChart
              groups={last12.map((m) => m.period)}
              series={[
                { label: "9L cases shipped ex-works", color: "#231F20", values: last12.map((m) => Math.round(m.shipment9lCases * 10) / 10) },
                { label: "9L cases depleted at retail", color: "#018769", values: last12.map((m) => m.depletionCases) },
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-slate/70">
              Both series are 9L-equivalent cases, so they compare like-for-like (a physical 6×700ml case
              is 0.47 of a 9L case). Healthy months deplete roughly what you ship. Shipping far ahead of
              depletions loads the channel (watch weeks of supply climb); depleting ahead of shipments
              drains it and a reorder from your importer is coming.
            </p>
          </Card>

          <div className="mt-6">
            <Card title="Monthly operating summary">
              <Table
                headers={["Month", "Depletions", "MoM", "Shipped", "Revenue", "Trade spend", "Expenses", "QB net", "Channel"]}
                align={["left", "right", "right", "right", "right", "right", "right", "right", "right"]}
              >
                {[...last12].reverse().map((m, idx, arr) => {
                  const prev = arr[idx + 1]; // reversed → next entry is the prior month
                  const mom =
                    prev && prev.depletionCases > 0 && m.depletionCases > 0
                      ? ((m.depletionCases - prev.depletionCases) / prev.depletionCases) * 100
                      : null;
                  const qbNet =
                    m.qbIncomeCents === null && m.qbExpenseCents === null
                      ? null
                      : (m.qbIncomeCents ?? 0) - (m.qbExpenseCents ?? 0);
                  return (
                    <tr key={m.period}>
                      <Td className="font-medium">{m.period}</Td>
                      <Td right>{m.depletionCases > 0 ? num(Math.round(m.depletionCases)) : "—"}</Td>
                      <Td right className={mom === null ? "" : mom >= 0 ? "text-agave-deep" : "text-burnt"}>
                        {mom === null ? "—" : `${mom >= 0 ? "+" : ""}${Math.round(mom)}%`}
                      </Td>
                      <Td right>{m.shipmentCases > 0 ? num(m.shipmentCases) : "—"}</Td>
                      <Td right>{m.shipmentRevenueCents > 0 ? money(m.shipmentRevenueCents) : "—"}</Td>
                      <Td right className={m.chargebackCents > 0 ? "text-burnt" : ""}>
                        {m.chargebackCents > 0 ? `−${money(m.chargebackCents)}` : "—"}
                      </Td>
                      <Td right>{m.expenseCents > 0 ? money(m.expenseCents) : "—"}</Td>
                      <Td right className={qbNet !== null && qbNet < 0 ? "text-burnt" : ""}>
                        {qbNet === null ? "—" : money(qbNet)}
                      </Td>
                      <Td right>{m.channelCases === null ? "—" : num(Math.round(m.channelCases))}</Td>
                    </tr>
                  );
                })}
              </Table>
              <p className="mt-3 text-xs text-slate/70">
                Depletions and channel stock come from your importer&apos;s reports; shipped cases and revenue
                from confirmed ex-works sales; trade spend is LSI chargebacks dated that month; QB net from
                the monthly P&amp;L upload. A dash means that source hasn&apos;t been uploaded yet.
              </p>
            </Card>
          </div>

          {showAnnual && (
            <div className="mt-6">
              <Card title="Annual view">
                <Table
                  headers={["Year", "Depletions", "Shipped", "Ex-works revenue", "QB income", "QB expenses", "QB net"]}
                  align={["left", "right", "right", "right", "right", "right", "right"]}
                >
                  {years.map(([y, r]) => {
                    const net = r.hasQb ? r.qbIncome - r.qbExpense : null;
                    return (
                      <tr key={y}>
                        <Td className="font-medium">{y}</Td>
                        <Td right>{r.depletions > 0 ? num(Math.round(r.depletions)) : "—"}</Td>
                        <Td right>{r.shipped > 0 ? num(r.shipped) : "—"}</Td>
                        <Td right>{r.revenue > 0 ? money(r.revenue) : "—"}</Td>
                        <Td right>{r.hasQb ? money(r.qbIncome) : "—"}</Td>
                        <Td right>{r.hasQb ? money(r.qbExpense) : "—"}</Td>
                        <Td right className={net !== null && net < 0 ? "text-burnt" : "font-medium"}>
                          {net === null ? "—" : money(net)}
                        </Td>
                      </tr>
                    );
                  })}
                </Table>
                <p className="mt-3 text-xs text-slate/70">
                  QB columns fill in as your bookkeeper&apos;s P&amp;L uploads land — historical years included.
                  The current year shows year-to-date.
                </p>
              </Card>
            </div>
          )}

          {skuMix.products.length > 0 && (
            <div className="mt-6">
              <Card title="Depletions by SKU (national)">
                <Table
                  headers={["Product", "Tier", ...skuMix.periods, "3-mo avg"]}
                  align={["left", "left", ...skuMix.periods.map(() => "right" as const), "right"]}
                >
                  {skuMix.products.map((p) => {
                    const vals = skuMix.periods.map((per) => skuMix.cases.get(`${p.id}|${per}`) ?? 0);
                    const last3 = vals.slice(-3);
                    const avg = last3.length > 0 ? last3.reduce((a, v) => a + v, 0) / last3.length : 0;
                    return (
                      <tr key={p.id}>
                        <Td>{p.name}</Td>
                        <Td><TierBadge tier={p.tier} /></Td>
                        {vals.map((v, i) => (
                          <Td key={skuMix.periods[i]} right>{v > 0 ? num(Math.round(v)) : "—"}</Td>
                        ))}
                        <Td right className="font-medium">{num(Math.round(avg * 10) / 10)}</Td>
                      </tr>
                    );
                  })}
                </Table>
              </Card>
            </div>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title={`Markets — YTD${markets.asOf ? ` (as of ${markets.asOf})` : ""}`}>
              {markets.rows.length === 0 ? (
                <EmptyState>Market stats appear once a commercial report is uploaded.</EmptyState>
              ) : (
                <Table
                  headers={["Market", "YTD", "LY", "Growth", "Accounts", "Velocity"]}
                  align={["left", "right", "right", "left", "right", "right"]}
                >
                  {markets.rows.map((r) => (
                    <tr key={r.market}>
                      <Td className="font-medium">{r.market}</Td>
                      <Td right>{num(Math.round(r.ytdCases))}</Td>
                      <Td right>{r.ytdCasesLY === null ? "—" : num(Math.round(r.ytdCasesLY))}</Td>
                      <Td>{growthBadge(r.growthPct)}</Td>
                      <Td right>{num(r.accounts)}</Td>
                      <Td right>{r.velocity === null ? "—" : num(Math.round(r.velocity * 10) / 10)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>

            <Card title={`Top chains — YTD${chains.asOf ? ` (as of ${chains.asOf})` : ""}`}>
              {chains.rows.length === 0 ? (
                <EmptyState>Chain volumes appear once a commercial report is uploaded.</EmptyState>
              ) : (
                <Table headers={["Chain", "YTD", "LY", "Growth"]} align={["left", "right", "right", "left"]}>
                  {chains.rows.slice(0, 12).map((r) => (
                    <tr key={r.chain}>
                      <Td>{r.chain}</Td>
                      <Td right>{num(Math.round(r.ytdCases))}</Td>
                      <Td right>{r.ytdCasesLY === null ? "—" : num(Math.round(r.ytdCasesLY))}</Td>
                      <Td>{growthBadge(r.growthPct)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>

          <div className="mt-6">
            <Callout tone="green">
              <span className="font-medium">How this page builds itself:</span>{" "}
              every upload is stored
              against its month — commercial reports feed depletions, markets and chains; LSI inventory
              workbooks feed channel stock; ex-works sales and expenses are recorded as you work; your
              bookkeeper&apos;s QB P&amp;L feeds the net line. Re-uploading a month replaces that month only,
              so the history stays clean and these numbers get sharper with every report.
            </Callout>
          </div>
        </>
      )}
    </div>
  );
}
