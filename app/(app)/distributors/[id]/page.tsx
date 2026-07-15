import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, num, dateStr } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { updateDistributor } from "../actions";

export default async function DistributorDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const d = await db.distributor.findUnique({
    where: { id },
    include: {
      shipments: {
        orderBy: { date: "desc" },
        include: { lines: { include: { product: true } } },
      },
      depletions: {
        orderBy: [{ period: "desc" }],
        include: { product: true },
        take: 50,
      },
    },
  });
  if (!d) notFound();

  // depletions by month for a quick trend
  const byPeriod = new Map<string, number>();
  const allDeps = await db.depletion.findMany({ where: { distributorId: id } });
  for (const dep of allDeps) {
    byPeriod.set(dep.period, (byPeriod.get(dep.period) ?? 0) + dep.cases);
  }
  const trend = [...byPeriod.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);

  return (
    <div>
      <PageHeader title={d.name} subtitle={d.market ? `Market: ${d.market}` : undefined} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Shipments">
            {d.shipments.length === 0 ? (
              <EmptyState>No shipments to this distributor yet.</EmptyState>
            ) : (
              <Table headers={["Date", "Invoice", "Products", "Cases", "Value", "Status"]} align={["left", "left", "left", "right", "right", "left"]}>
                {d.shipments.map((s) => {
                  const cases = s.lines.reduce((a, l) => a + l.cases, 0);
                  const value = s.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
                  return (
                    <tr key={s.id}>
                      <Td>{dateStr(s.date)}</Td>
                      <Td>{s.invoiceNumber || "—"}</Td>
                      <Td className="text-xs">{s.lines.map((l) => `${l.cases}× ${l.product.sku}`).join(", ")}</Td>
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

          <Card title="Depletion trend (cases by month)">
            {trend.length === 0 ? (
              <EmptyState>No depletion data yet — import a report from the Depletions page.</EmptyState>
            ) : (
              <Table headers={["Month", "Cases"]} align={["left", "right"]}>
                {trend.map(([period, cases]) => (
                  <tr key={period}>
                    <Td>{period}</Td>
                    <Td right>{num(Math.round(cases * 10) / 10)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Recent depletion records">
            {d.depletions.length === 0 ? (
              <EmptyState>No records yet.</EmptyState>
            ) : (
              <Table headers={["Period", "Product", "Account", "Type", "Cases"]} align={["left", "left", "left", "left", "right"]}>
                {d.depletions.map((dep) => (
                  <tr key={dep.id}>
                    <Td>{dep.period}</Td>
                    <Td>{dep.product.name}</Td>
                    <Td>{dep.accountName || "—"}</Td>
                    <Td className="text-xs">{dep.accountType.replace(/_/g, " ")}</Td>
                    <Td right>{num(dep.cases)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <Card title="Details">
          <form action={updateDistributor} className="space-y-3">
            <input type="hidden" name="id" value={d.id} />
            <Field label="Name">
              <input name="name" defaultValue={d.name} required className={inputCls} />
            </Field>
            <Field label="Market">
              <input name="market" defaultValue={d.market} className={inputCls} />
            </Field>
            <Field label="Contact name">
              <input name="contactName" defaultValue={d.contactName} className={inputCls} />
            </Field>
            <Field label="Email">
              <input name="email" defaultValue={d.email} className={inputCls} />
            </Field>
            <Field label="Phone">
              <input name="phone" defaultValue={d.phone} className={inputCls} />
            </Field>
            <Field label="Notes">
              <textarea name="notes" rows={3} defaultValue={d.notes} className={inputCls} />
            </Field>
            <button className={btnCls}>Save</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
