import Link from "next/link";
import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStock, getComponentStock } from "@/lib/inventory";
import { getMarketPosition } from "@/lib/market";
import { getOpenReceivables } from "@/lib/receivables";
import { money, num, dateStr, currentPeriod } from "@/lib/format";
import { Card, Stat, Table, Td, Badge, TierBadge, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requireOps();

  const period = currentPeriod();
  const yearStart = `${period.slice(0, 4)}-01`;

  const in90d = new Date(Date.now() + 90 * 86_400_000);
  const [stock, position, components, componentStock, ytdDep, unpaid, recentSales, recentRuns, legalDue] =
    await Promise.all([
      getStock(),
      getMarketPosition(),
      db.component.findMany({ where: { active: true } }),
      getComponentStock(),
      db.depletion.aggregate({ where: { period: { gte: yearStart } }, _sum: { cases: true } }),
      getOpenReceivables(),
      db.exWorksSale.findMany({
        orderBy: { date: "desc" },
        take: 4,
        include: { importer: true, lines: true },
      }),
      db.productionRun.findMany({
        orderBy: { startDate: "desc" },
        take: 4,
        include: { product: true },
      }),
      db.legalRecord.findMany({
        where: { status: "ACTIVE", dueDate: { not: null, lte: in90d } },
        orderBy: { dueDate: "asc" },
      }),
    ]);

  const fgCases = stock.reduce((a, s) => a + Math.floor(s.totalBottles / s.bottlesPerCase), 0);
  const channelCases = position.reduce((a, p) => a + p.channelCases, 0);
  const receivables = unpaid.totalNetCents;

  const lowComponents = components.filter(
    (c) => c.reorderPoint > 0 && (componentStock.get(c.id) ?? 0) < c.reorderPoint
  );
  const restock = position.filter((p) => p.weeksOfSupply !== null && p.weeksOfSupply < 8);

  return (
    <div>
      <PageHeader
        label="Tequila De Nada"
        title="Dashboard"
        subtitle="From agave to account — the whole operation at a glance."
      />

      {legalDue.length > 0 && (
        <div className="mb-6 rounded-md border border-reposado/40 bg-reposado/10 p-4">
          <div className="brand-heading mb-1 text-sm text-burnt">Legal & compliance deadlines</div>
          <ul className="space-y-1 text-sm text-ink/90">
            {legalDue.map((r) => {
              const past = r.dueDate! < new Date();
              return (
                <li key={r.id}>
                  <span className="font-medium">{r.title}</span>
                  {r.reference && <span className="text-slate"> ({r.reference})</span>}:{" "}
                  <span className={past ? "font-medium text-burnt" : ""}>
                    {past ? "EXPIRED" : "due"} {dateStr(r.dueDate)}
                  </span>{" "}
                  — <Link href="/legal" className="text-agave-deep underline">open Legal &amp; IP</Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(restock.length > 0 || lowComponents.length > 0) && (
        <div className="mb-6 rounded-md border border-burnt/30 bg-burnt/8 p-4">
          <div className="brand-heading mb-1 text-sm text-burnt">Action needed</div>
          <ul className="space-y-1 text-sm text-ink/90">
            {restock.map((p) => (
              <li key={p.productId}>
                <span className="font-medium">{p.name}</span>: ~{num(Math.round(p.weeksOfSupply!))} weeks of supply left in the channel
                ({num(Math.round(p.channelCases))} cases at {num(Math.round(p.velocityCasesPerMonth * 10) / 10)}/mo) —{" "}
                <Link href="/production" className="text-agave-deep underline">plan a production run</Link>
              </li>
            ))}
            {lowComponents.map((c) => (
              <li key={c.id}>
                <span className="font-medium">{c.name}</span>: {num(Math.round(componentStock.get(c.id) ?? 0))} on hand, below reorder point of {num(c.reorderPoint)} ({c.leadTimeDays}-day lead) —{" "}
                <Link href="/purchasing" className="text-agave-deep underline">raise a PO</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Finished goods · MX" value={`${num(fgCases)} cases`} hint="Your stock at the distillery" />
        <Stat label="Cases in channel · US" value={`${num(Math.round(channelCases))}`} hint="Importer + distributors, latest reports" tone="agave" />
        <Stat label="Depletions · YTD" value={`${num(Math.round(ytdDep._sum.cases ?? 0))} cases`} hint="Sold through to retail" />
        <Stat
          label="Open receivables"
          value={money(receivables)}
          tone={receivables > 0 ? "reposado" : "ink"}
          hint={`${unpaid.items.length} unpaid invoice${unpaid.items.length === 1 ? "" : "s"}, net of chargeback credits`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Market position">
          {position.length === 0 ? (
            <EmptyState>No products yet.</EmptyState>
          ) : (
            <Table
              headers={["Product", "Tier", "Channel", "Velocity", "Weeks"]}
              align={["left", "left", "right", "right", "right"]}
            >
              {position.map((p) => (
                <tr key={p.productId}>
                  <Td>{p.name}</Td>
                  <Td><TierBadge tier={p.tier} /></Td>
                  <Td right>{num(Math.round(p.channelCases))}</Td>
                  <Td right>{p.velocityCasesPerMonth > 0 ? num(Math.round(p.velocityCasesPerMonth * 10) / 10) : "—"}</Td>
                  <Td right className="font-medium">
                    {p.weeksOfSupply === null ? "—" : num(Math.round(p.weeksOfSupply))}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Finished goods by product">
          {stock.length === 0 ? (
            <EmptyState>
              No stock yet. <Link className="text-agave-deep underline" href="/production">Complete a production run</Link> to add bottles.
            </EmptyState>
          ) : (
            <Table headers={["SKU", "Product", "Bottles", "Cases"]} align={["left", "left", "right", "right"]}>
              {stock.map((s) => (
                <tr key={s.productId}>
                  <Td><span className="font-mono text-xs">{s.sku}</span></Td>
                  <Td>{s.name}</Td>
                  <Td right>{num(s.totalBottles)}</Td>
                  <Td right>{num(Math.floor(s.totalBottles / s.bottlesPerCase))}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Recent ex-works sales">
          {recentSales.length === 0 ? (
            <EmptyState>
              No sales yet. <Link className="text-agave-deep underline" href="/sales">Record your first ex-works sale</Link>.
            </EmptyState>
          ) : (
            <Table headers={["Date", "Importer", "Cases", "Value", "Status"]} align={["left", "left", "right", "right", "left"]}>
              {recentSales.map((s) => {
                const cases = s.lines.reduce((a, l) => a + l.cases, 0);
                const value = s.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
                return (
                  <tr key={s.id}>
                    <Td>{dateStr(s.date)}</Td>
                    <Td>{s.importer.name}</Td>
                    <Td right>{num(cases)}</Td>
                    <Td right>{money(value)}</Td>
                    <Td>
                      {s.status === "DRAFT" ? <Badge>Draft</Badge>
                        : s.invoiceStatus === "PAID" ? <Badge tone="green">Paid</Badge>
                        : <Badge tone="amber">Unpaid</Badge>}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        <Card title="Recent production">
          {recentRuns.length === 0 ? (
            <EmptyState>
              No runs yet. <Link className="text-agave-deep underline" href="/production">Plan your first run</Link>.
            </EmptyState>
          ) : (
            <Table headers={["Lot", "Product", "Bottles", "Status"]} align={["left", "left", "right", "left"]}>
              {recentRuns.map((r) => (
                <tr key={r.id}>
                  <Td><span className="font-mono text-xs">{r.lotCode}</span></Td>
                  <Td>{r.product.name}</Td>
                  <Td right>{num(r.status === "COMPLETED" ? r.bottlesProduced : r.bottlesPlanned)}</Td>
                  <Td>
                    {r.status === "COMPLETED" ? <Badge tone="green">Completed</Badge>
                      : r.status === "IN_PROGRESS" ? <Badge tone="blue">In progress</Badge>
                      : <Badge>Planned</Badge>}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
