import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { num } from "@/lib/format";
import { PageHeader, Card, Table, Td, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { updateImporter, createImporter, createDistributor } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export default async function PartnersPage() {
  await requireOps();
  const importers = await db.importer.findMany({
    orderBy: { name: "asc" },
    include: {
      distributors: { orderBy: { market: "asc" }, include: { depletions: true } },
      sales: { where: { status: "CONFIRMED" }, include: { lines: true } },
    },
  });

  return (
    <div>
      <PageHeader
        label="Market · United States"
        title="Importer & Distributors"
        subtitle="Your importer and distributor network, market by market."
      />

      <div className="space-y-6">
        {importers.map((imp) => {
          const casesSold = imp.sales.reduce(
            (a, s) => a + s.lines.reduce((x, l) => x + l.cases, 0),
            0
          );
          return (
            <Card key={imp.id} title={`Importer — ${imp.name}`}>
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <div className="mb-3 text-sm text-slate">
                    {num(casesSold)} cases purchased ex-works · {imp.distributors.length} distributor{imp.distributors.length === 1 ? "" : "s"}
                  </div>
                  {imp.distributors.length === 0 ? (
                    <EmptyState>No distributors mapped yet — add the ones from your importer&apos;s reports.</EmptyState>
                  ) : (
                    <Table headers={["Distributor", "Market", "Cases depleted (all time)"]} align={["left", "left", "right"]}>
                      {imp.distributors.map((d) => (
                        <tr key={d.id}>
                          <Td className="font-medium">{d.name}</Td>
                          <Td>{d.market || "—"}</Td>
                          <Td right>{num(Math.round(d.depletions.reduce((a, x) => a + x.cases, 0)))}</Td>
                        </tr>
                      ))}
                    </Table>
                  )}
                  <form action={createDistributor} className="mt-4 flex items-end gap-2">
                    <input type="hidden" name="importerId" value={imp.id} />
                    <Field label="Add distributor" className="flex-1">
                      <input name="name" required placeholder="Southern Glazer's" className={inputCls} />
                    </Field>
                    <Field label="Market" className="w-24">
                      <input name="market" placeholder="TX" className={inputCls} />
                    </Field>
                    <SubmitButton>Add</SubmitButton>
                  </form>
                </div>

                <form action={updateImporter} className="space-y-3">
                  <input type="hidden" name="id" value={imp.id} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Name">
                      <input name="name" defaultValue={imp.name} required className={inputCls} />
                    </Field>
                    <Field label="Country">
                      <input name="country" defaultValue={imp.country} className={inputCls} />
                    </Field>
                  </div>
                  <Field label="Contact">
                    <input name="contactName" defaultValue={imp.contactName} className={inputCls} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Email">
                      <input name="email" defaultValue={imp.email} className={inputCls} />
                    </Field>
                    <Field label="Phone">
                      <input name="phone" defaultValue={imp.phone} className={inputCls} />
                    </Field>
                  </div>
                  <Field label="Notes (fees, terms, etc.)">
                    <textarea name="notes" rows={3} defaultValue={imp.notes} className={inputCls} />
                  </Field>
                  <SubmitButton>Save importer</SubmitButton>
                </form>
              </div>
            </Card>
          );
        })}

        <Card title="Add importer" collapsible>
          <form action={createImporter} className="flex flex-wrap items-end gap-3">
            <Field label="Name" className="min-w-56 flex-1">
              <input name="name" required placeholder="New importer (e.g. for a second country)" className={inputCls} />
            </Field>
            <Field label="Country" className="w-32">
              <input name="country" defaultValue="USA" className={inputCls} />
            </Field>
            <Field label="Contact" className="w-44">
              <input name="contactName" className={inputCls} />
            </Field>
            <Field label="Email" className="w-52">
              <input name="email" type="email" className={inputCls} />
            </Field>
            <SubmitButton>Add importer</SubmitButton>
          </form>
        </Card>
      </div>
    </div>
  );
}
