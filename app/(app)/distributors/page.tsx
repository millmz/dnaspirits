import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { num } from "@/lib/format";
import { PageHeader, Card, Table, Td, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { createDistributor } from "./actions";

export default async function DistributorsPage() {
  await requireUser();
  const distributors = await db.distributor.findMany({
    orderBy: { name: "asc" },
    include: { shipments: { include: { lines: true } }, depletions: true },
  });

  return (
    <div>
      <PageHeader
        title="Distributors"
        subtitle="Your wholesale partners by market"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="All distributors">
            {distributors.length === 0 ? (
              <EmptyState>No distributors yet — add your first partner on the right.</EmptyState>
            ) : (
              <Table
                headers={["Name", "Market", "Contact", "Cases shipped", "Cases depleted"]}
                align={["left", "left", "left", "right", "right"]}
              >
                {distributors.map((d) => {
                  const shipped = d.shipments
                    .filter((s) => s.status === "SHIPPED")
                    .reduce((a, s) => a + s.lines.reduce((x, l) => x + l.cases, 0), 0);
                  const depleted = d.depletions.reduce((a, dep) => a + dep.cases, 0);
                  return (
                    <tr key={d.id}>
                      <Td>
                        <Link href={`/distributors/${d.id}`} className="font-medium text-emerald-700 hover:underline">
                          {d.name}
                        </Link>
                      </Td>
                      <Td>{d.market || "—"}</Td>
                      <Td>{d.contactName || "—"}</Td>
                      <Td right>{num(shipped)}</Td>
                      <Td right>{num(Math.round(depleted))}</Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
        </div>

        <Card title="Add distributor">
          <form action={createDistributor} className="space-y-3">
            <Field label="Name">
              <input name="name" required placeholder="Southern Glazer's — TX" className={inputCls} />
            </Field>
            <Field label="Market (state/region)">
              <input name="market" placeholder="TX" className={inputCls} />
            </Field>
            <Field label="Contact name">
              <input name="contactName" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email">
                <input name="email" type="email" className={inputCls} />
              </Field>
              <Field label="Phone">
                <input name="phone" className={inputCls} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea name="notes" rows={2} className={inputCls} />
            </Field>
            <button className={btnCls}>Add distributor</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
