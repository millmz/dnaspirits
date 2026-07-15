import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, dateStr } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls, btnSecondaryCls, EmptyState } from "@/components/ui";
import { createCampaign, createActivity, setCampaignStatus } from "./actions";

const ACTIVITY_TYPES = [
  ["EVENT", "Event"],
  ["TASTING", "Tasting"],
  ["DIGITAL", "Digital / Social"],
  ["SPONSORSHIP", "Sponsorship"],
  ["OTHER", "Other"],
] as const;

export default async function MarketingPage() {
  await requireUser();
  const [campaigns, activities] = await Promise.all([
    db.campaign.findMany({
      orderBy: { startDate: "desc" },
      include: { activities: true },
    }),
    db.marketingActivity.findMany({
      orderBy: { date: "desc" },
      take: 50,
      include: { campaign: true },
    }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Marketing"
        subtitle="Campaigns, events, and tastings — budget vs. actual spend by market"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Campaigns">
            {campaigns.length === 0 ? (
              <EmptyState>No campaigns yet — create one on the right.</EmptyState>
            ) : (
              <div className="space-y-4">
                {campaigns.map((c) => {
                  const spent = c.activities.reduce((a, x) => a + x.costCents, 0);
                  const pct = c.budgetCents > 0 ? Math.min(100, Math.round((spent / c.budgetCents) * 100)) : 0;
                  return (
                    <div key={c.id} className="rounded-lg border border-stone-200 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">
                          {c.name}
                          {c.market && <span className="ml-2 text-sm font-normal text-stone-500">· {c.market}</span>}
                        </div>
                        {c.status === "ACTIVE" ? <Badge tone="green">Active</Badge>
                          : c.status === "PLANNED" ? <Badge tone="blue">Planned</Badge>
                          : <Badge>Completed</Badge>}
                      </div>
                      <div className="mt-1 text-sm text-stone-500">
                        {dateStr(c.startDate)}{c.endDate ? ` → ${dateStr(c.endDate)}` : " → ongoing"}
                        {" · "}{c.activities.length} activit{c.activities.length === 1 ? "y" : "ies"}
                      </div>
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-stone-500">
                          <span>Spent {money(spent)}</span>
                          <span>Budget {money(c.budgetCents)}</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100">
                          <div
                            className={`h-full rounded-full ${spent > c.budgetCents && c.budgetCents > 0 ? "bg-red-500" : "bg-emerald-600"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      {c.status !== "COMPLETED" && (
                        <form action={setCampaignStatus} className="mt-3">
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="status" value={c.status === "PLANNED" ? "ACTIVE" : "COMPLETED"} />
                          <button className={btnSecondaryCls}>
                            {c.status === "PLANNED" ? "Mark active" : "Mark completed"}
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="Recent activity">
            {activities.length === 0 ? (
              <EmptyState>No events or activities logged yet.</EmptyState>
            ) : (
              <Table headers={["Date", "Activity", "Type", "Market", "Campaign", "Cost"]} align={["left", "left", "left", "left", "left", "right"]}>
                {activities.map((a) => (
                  <tr key={a.id}>
                    <Td>{dateStr(a.date)}</Td>
                    <Td>{a.name}</Td>
                    <Td><Badge>{ACTIVITY_TYPES.find(([k]) => k === a.type)?.[1] ?? a.type}</Badge></Td>
                    <Td>{a.market || "—"}</Td>
                    <Td className="text-stone-500">{a.campaign?.name ?? "—"}</Td>
                    <Td right>{money(a.costCents)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="New campaign">
            <form action={createCampaign} className="space-y-3">
              <Field label="Name">
                <input name="name" required placeholder="Texas Summer Launch" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Market">
                  <input name="market" placeholder="TX" className={inputCls} />
                </Field>
                <Field label="Budget ($)">
                  <input name="budget" placeholder="10000" className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start">
                  <input name="startDate" type="date" defaultValue={today} className={inputCls} />
                </Field>
                <Field label="End (optional)">
                  <input name="endDate" type="date" className={inputCls} />
                </Field>
              </div>
              <Field label="Status">
                <select name="status" className={inputCls}>
                  <option value="PLANNED">Planned</option>
                  <option value="ACTIVE">Active</option>
                </select>
              </Field>
              <Field label="Notes">
                <textarea name="notes" rows={2} className={inputCls} />
              </Field>
              <button className={btnCls}>Create campaign</button>
            </form>
          </Card>

          <Card title="Log activity / event">
            <form action={createActivity} className="space-y-3">
              <Field label="Name">
                <input name="name" required placeholder="Tasting @ Total Wine Austin" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date">
                  <input name="date" type="date" defaultValue={today} className={inputCls} />
                </Field>
                <Field label="Type">
                  <select name="type" className={inputCls}>
                    {ACTIVITY_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Market">
                  <input name="market" placeholder="TX" className={inputCls} />
                </Field>
                <Field label="Cost ($)">
                  <input name="cost" placeholder="350" className={inputCls} />
                </Field>
              </div>
              <Field label="Campaign (optional)">
                <select name="campaignId" className={inputCls}>
                  <option value="">— none —</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Notes">
                <input name="notes" className={inputCls} />
              </Field>
              <button className={btnCls}>Log activity</button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
