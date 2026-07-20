import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { num } from "@/lib/format";
import { PageHeader, Card, Badge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { createPartner, updatePartnerStatus, deletePartner } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const STATUSES = [
  ["PROSPECT", "Prospect"],
  ["CONTACTED", "Contacted"],
  ["AGREED", "Agreed"],
  ["SEEDED", "Product sent"],
  ["POSTED", "Posted / covered"],
  ["PASSED", "Passed"],
] as const;

const STATUS_TONE: Record<string, "gray" | "blue" | "amber" | "green" | "red"> = {
  PROSPECT: "gray",
  CONTACTED: "blue",
  AGREED: "amber",
  SEEDED: "amber",
  POSTED: "green",
  PASSED: "red",
};

export default async function InfluencersPage() {
  await requireOps();
  const partners = await db.partner.findMany({ orderBy: { updatedAt: "desc" } });

  const pipeline = STATUSES.filter(([k]) => k !== "PASSED").map(([k, label]) => ({
    key: k,
    label,
    items: partners.filter((p) => p.status === k),
  }));

  return (
    <div>
      <PageHeader
        label="Marketing"
        title="Influencers & PR"
        subtitle="Seeding, partnerships, and press — from prospect to posted."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {pipeline.map((col) => (
          <div key={col.key} className="rounded-md border border-ink/10 bg-white/60 p-3">
            <div className="brand-heading mb-1 text-[11px] text-slate">{col.label}</div>
            <div className="brand-heading text-2xl text-ink">{col.items.length}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="All partners">
            {partners.length === 0 ? (
              <EmptyState>No influencers or press contacts yet — add your first on the right.</EmptyState>
            ) : (
              <div className="space-y-3">
                {partners.map((p) => (
                  <div key={p.id} className="rounded-md border border-ink/10 bg-white/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium">{p.name}</span>
                        {p.handle && <span className="ml-2 text-sm text-slate">{p.handle}</span>}
                        <span className="ml-2 text-xs text-slate/70">
                          {[p.platform, p.market, p.followers > 0 ? `${num(p.followers)} followers` : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge>{p.type === "PRESS" ? "Press" : "Influencer"}</Badge>
                        <Badge tone={STATUS_TONE[p.status]}>
                          {STATUSES.find(([k]) => k === p.status)?.[1] ?? p.status}
                        </Badge>
                      </div>
                    </div>
                    {p.notes && <div className="mt-2 text-sm text-slate">{p.notes}</div>}
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <form action={updatePartnerStatus} className="flex flex-1 flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={p.id} />
                        <Field label="Status" className="w-40">
                          <select name="status" defaultValue={p.status} className={inputCls}>
                            {STATUSES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                          </select>
                        </Field>
                        <Field label="Notes" className="min-w-48 flex-1">
                          <input name="notes" defaultValue={p.notes} className={inputCls} />
                        </Field>
                        <SubmitButton>Update</SubmitButton>
                      </form>
                      <form action={deletePartner}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="pb-2.5 text-xs text-slate/60 hover:text-burnt">Delete</button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card title="Add partner" collapsible>
          <form action={createPartner} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select name="type" className={inputCls}>
                  <option value="INFLUENCER">Influencer</option>
                  <option value="PRESS">Press / publication</option>
                </select>
              </Field>
              <Field label="Status">
                <select name="status" className={inputCls}>
                  {STATUSES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Name">
              <input name="name" required placeholder="Host-adjacent creator / drinks writer" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Handle">
                <input name="handle" placeholder="@..." className={inputCls} />
              </Field>
              <Field label="Platform / outlet">
                <input name="platform" placeholder="Instagram / Punch" className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Market">
                <input name="market" placeholder="NYC" className={inputCls} />
              </Field>
              <Field label="Followers / reach">
                <input name="followers" type="number" placeholder="25000" className={inputCls} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea name="notes" rows={2} className={inputCls} />
            </Field>
            <SubmitButton>Add partner</SubmitButton>
            <p className="text-xs text-slate/70">
              Playbook filter: modern hosts and cooks — not nightlife, not celebrity-flash.
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
