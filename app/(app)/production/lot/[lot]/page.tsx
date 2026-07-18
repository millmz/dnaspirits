import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, money, dateStr } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, EmptyState } from "@/components/ui";

/**
 * Lot traceability: everything known about one lot code — the run, the dry
 * goods consumed, and every finished-goods movement (production in, sales
 * out, adjustments). Recall-readiness in one page.
 */
export default async function LotPage({ params }: { params: Promise<{ lot: string }> }) {
  await requireOps();
  const { lot } = await params;
  const lotCode = decodeURIComponent(lot);

  const run = await db.productionRun.findUnique({
    where: { lotCode },
    include: {
      product: true,
      warehouse: true,
      movements: { include: { warehouse: true, sale: { include: { importer: true } } }, orderBy: { date: "asc" } },
    },
  });
  if (!run) notFound();

  const consumed = await db.componentMovement.findMany({
    where: { type: "PRODUCTION", reference: { contains: lotCode } },
    include: { component: true },
    orderBy: { date: "asc" },
  });

  const sold = run.movements.filter((m) => m.type === "EX_WORKS_SALE");

  return (
    <div>
      <PageHeader
        label="Supply Chain · MX"
        title={`Lot ${run.lotCode}`}
        subtitle={`${run.product.name} (${run.product.sku}) — full trace from dry goods to shipment.`}
      />
      <Link href="/production" className="brand-heading mb-4 inline-block text-sm text-agave hover:underline">
        ← Back to production
      </Link>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Production run">
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <Badge tone={run.status === "COMPLETED" ? "green" : run.status === "IN_PROGRESS" ? "amber" : "gray"}>{run.status}</Badge>
              <span className="text-slate/80">{run.warehouse.name}</span>
            </div>
            <div>Started {dateStr(run.startDate)}{run.bottledDate && ` · bottled ${dateStr(run.bottledDate)}`}</div>
            <div>{num(run.bottlesProduced || run.bottlesPlanned)} bottles {run.bottlesProduced ? "produced" : "planned"}</div>
            {run.agaveSource && <div>Agave: {run.agaveSource}</div>}
            {run.distillery && <div>Distillery: {run.distillery}</div>}
            {run.totalCostCents > 0 && <div>Total cost: {money(run.totalCostCents)}</div>}
            {run.notes && <div className="text-slate/80">{run.notes}</div>}
          </div>
        </Card>

        <Card title="Dry goods consumed">
          {consumed.length === 0 ? (
            <EmptyState>No component consumption recorded against this lot.</EmptyState>
          ) : (
            <Table headers={["Component", "Qty", "Date"]} align={["left", "right", "left"]}>
              {consumed.map((m) => (
                <tr key={m.id}>
                  <Td>{m.component.name}</Td>
                  <Td right>{num(Math.abs(m.qty))} {m.component.unit}</Td>
                  <Td>{dateStr(m.date)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <div className="lg:col-span-2">
          <Card title={`Finished-goods movements (${run.movements.length})`}>
            {run.movements.length === 0 ? (
              <EmptyState>No inventory movements yet for this lot.</EmptyState>
            ) : (
              <Table headers={["Date", "Type", "Bottles", "Warehouse", "Where it went"]} align={["left", "left", "right", "left", "left"]}>
                {run.movements.map((m) => (
                  <tr key={m.id}>
                    <Td>{dateStr(m.date)}</Td>
                    <Td><Badge tone={m.type === "PRODUCTION" ? "green" : m.type === "EX_WORKS_SALE" ? "blue" : "gray"}>{m.type}</Badge></Td>
                    <Td right>{num(m.bottles)}</Td>
                    <Td>{m.warehouse.name}</Td>
                    <Td>{m.sale ? `Sold to ${m.sale.importer.name} (${dateStr(m.sale.date)})` : m.notes || "—"}</Td>
                  </tr>
                ))}
              </Table>
            )}
            {sold.length > 0 && (
              <p className="mt-3 text-xs text-slate/70">
                {num(sold.reduce((a, m) => a + Math.abs(m.bottles), 0))} bottles from this lot have shipped ex-works.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
