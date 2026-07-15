import Link from "next/link";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
import { db } from "@/lib/db";
import { getStock } from "@/lib/inventory";
import { money, num, dateStr, currentPeriod } from "@/lib/format";
import { Card, Stat, Table, Td, Badge, EmptyState, PageHeader } from "@/components/ui";

export default async function Dashboard() {
  await requireUser();

  const period = currentPeriod();
  const yearStart = `${period.slice(0, 4)}-01`;

  const [stock, ytdDepletions, monthDepletions, unpaidShipments, recentShipments, recentRuns, expensesYtd] =
    await Promise.all([
      getStock(),
      db.depletion.aggregate({
        where: { period: { gte: yearStart } },
        _sum: { cases: true },
      }),
      db.depletion.aggregate({
        where: { period },
        _sum: { cases: true },
      }),
      db.shipment.findMany({
        where: { status: "SHIPPED", invoiceStatus: "UNPAID" },
        include: { lines: true, distributor: true },
      }),
      db.shipment.findMany({
        orderBy: { date: "desc" },
        take: 5,
        include: { distributor: true, lines: true },
      }),
      db.productionRun.findMany({
        orderBy: { startDate: "desc" },
        take: 5,
        include: { product: true },
      }),
      db.expense.aggregate({
        where: { date: { gte: new Date(`${period.slice(0, 4)}-01-01`) } },
        _sum: { amountCents: true },
      }),
    ]);

  const totalCases = stock.reduce(
    (acc, s) => acc + s.totalBottles / s.bottlesPerCase,
    0
  );
  const receivablesCents = unpaidShipments.reduce(
    (acc, s) => acc + s.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0),
    0
  );

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Denada Tequila at a glance"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Inventory on hand"
          value={`${num(Math.floor(totalCases))} cases`}
          hint={`${num(stock.reduce((a, s) => a + s.totalBottles, 0))} bottles across all SKUs`}
        />
        <Stat
          label={`Depletions · ${period}`}
          value={`${num(Math.round(monthDepletions._sum.cases ?? 0))} cases`}
          hint="This month, all markets"
        />
        <Stat
          label="Depletions · YTD"
          value={`${num(Math.round(ytdDepletions._sum.cases ?? 0))} cases`}
        />
        <Stat
          label="Open receivables"
          value={money(receivablesCents)}
          hint={`${unpaidShipments.length} unpaid invoice${unpaidShipments.length === 1 ? "" : "s"} · YTD expenses ${money(expensesYtd._sum.amountCents ?? 0)}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Inventory by product">
          {stock.length === 0 ? (
            <EmptyState>
              No products yet. <Link className="text-emerald-700 underline" href="/products">Add your first product</Link>.
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

        <Card title="Recent shipments">
          {recentShipments.length === 0 ? (
            <EmptyState>
              No shipments yet. <Link className="text-emerald-700 underline" href="/shipments">Record a shipment</Link> when you sell to a distributor.
            </EmptyState>
          ) : (
            <Table headers={["Date", "Distributor", "Cases", "Value", "Status"]} align={["left", "left", "right", "right", "left"]}>
              {recentShipments.map((s) => {
                const cases = s.lines.reduce((a, l) => a + l.cases, 0);
                const value = s.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
                return (
                  <tr key={s.id}>
                    <Td>{dateStr(s.date)}</Td>
                    <Td>{s.distributor.name}</Td>
                    <Td right>{num(cases)}</Td>
                    <Td right>{money(value)}</Td>
                    <Td>
                      {s.status === "DRAFT" ? (
                        <Badge tone="gray">Draft</Badge>
                      ) : s.invoiceStatus === "PAID" ? (
                        <Badge tone="green">Paid</Badge>
                      ) : (
                        <Badge tone="amber">Unpaid</Badge>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        <Card title="Recent production runs" className="lg:col-span-2">
          {recentRuns.length === 0 ? (
            <EmptyState>
              No production runs yet. <Link className="text-emerald-700 underline" href="/production">Plan your first run</Link>.
            </EmptyState>
          ) : (
            <Table headers={["Lot", "Product", "Started", "Bottles", "Status"]} align={["left", "left", "left", "right", "left"]}>
              {recentRuns.map((r) => (
                <tr key={r.id}>
                  <Td><span className="font-mono text-xs">{r.lotCode}</span></Td>
                  <Td>{r.product.name}</Td>
                  <Td>{dateStr(r.startDate)}</Td>
                  <Td right>{num(r.status === "COMPLETED" ? r.bottlesProduced : r.bottlesPlanned)}</Td>
                  <Td>
                    {r.status === "COMPLETED" ? (
                      <Badge tone="green">Completed</Badge>
                    ) : r.status === "IN_PROGRESS" ? (
                      <Badge tone="blue">In progress</Badge>
                    ) : (
                      <Badge tone="gray">Planned</Badge>
                    )}
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
