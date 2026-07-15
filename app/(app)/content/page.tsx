import Link from "next/link";
import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Badge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { createPost, advancePost, deletePost } from "./actions";

const CHANNELS = [
  ["INSTAGRAM", "Instagram"],
  ["TIKTOK", "TikTok"],
  ["YOUTUBE", "YouTube"],
  ["EMAIL", "Email"],
  ["OTHER", "Other"],
] as const;

const chLabel = (k: string) => CHANNELS.find(([c]) => c === k)?.[1] ?? k;

const STATUS_TONE: Record<string, "gray" | "blue" | "amber" | "green"> = {
  IDEA: "gray",
  DRAFTED: "blue",
  SCHEDULED: "amber",
  POSTED: "green",
};

const NEXT_LABEL: Record<string, string> = {
  IDEA: "Mark drafted",
  DRAFTED: "Mark scheduled",
  SCHEDULED: "Mark posted",
};

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireOps();
  const { month } = await searchParams;
  const current = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : new Date().toISOString().slice(0, 7);

  const [year, mon] = current.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, mon - 1, 1));
  const monthEnd = new Date(Date.UTC(year, mon, 1));
  const prev = new Date(Date.UTC(year, mon - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 7);
  const monthName = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const posts = await db.socialPost.findMany({
    where: { date: { gte: monthStart, lt: monthEnd } },
    orderBy: { date: "asc" },
  });

  // month grid
  const firstDow = monthStart.getUTCDay(); // 0=Sun
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const byDay = new Map<number, typeof posts>();
  for (const p of posts) {
    const d = p.date.getUTCDate();
    byDay.set(d, [...(byDay.get(d) ?? []), p]);
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        label="Marketing"
        title="Content Calendar"
        subtitle="Plan social posts and email sends: idea → drafted → scheduled → posted. The De Nada voice: warm, host-first, never flashy."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <Link href={`/content?month=${prev}`} className="brand-heading text-sm text-agave hover:underline">← Prev</Link>
              <div className="brand-heading text-lg text-ink">{monthName}</div>
              <Link href={`/content?month=${next}`} className="brand-heading text-sm text-agave hover:underline">Next →</Link>
            </div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md bg-ink/10 text-xs">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="brand-heading bg-cream-deep px-2 py-1.5 text-center text-[10px] text-slate">
                  {d}
                </div>
              ))}
              {cells.map((day, i) => (
                <div key={i} className="min-h-20 bg-white/80 p-1.5">
                  {day && (
                    <>
                      <div className="mb-1 text-[10px] font-medium text-slate/60">{day}</div>
                      {(byDay.get(day) ?? []).map((p) => (
                        <div
                          key={p.id}
                          className={`mb-1 truncate rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
                            p.status === "POSTED"
                              ? "bg-agave/15 text-agave-deep"
                              : p.status === "SCHEDULED"
                              ? "bg-reposado/20 text-burnt"
                              : "bg-ink/8 text-slate"
                          }`}
                          title={`${p.title} (${chLabel(p.channel)}, ${p.status.toLowerCase()})`}
                        >
                          {p.title}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <div className="mt-6">
            <Card title={`Posts in ${monthName}`}>
              {posts.length === 0 ? (
                <EmptyState>Nothing planned this month yet.</EmptyState>
              ) : (
                <div className="space-y-2">
                  {posts.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-md border border-ink/8 bg-white/60 px-3 py-2">
                      <div className="w-20 text-xs text-slate">{p.date.toISOString().slice(0, 10)}</div>
                      <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                      <Badge>{chLabel(p.channel)}</Badge>
                      <div className="min-w-40 flex-1 text-sm font-medium">{p.title}</div>
                      {p.notes && <div className="w-full pl-20 text-xs text-slate/80 sm:w-auto sm:flex-1 sm:pl-0">{p.notes}</div>}
                      <div className="flex items-center gap-2">
                        {p.status !== "POSTED" && (
                          <form action={advancePost}>
                            <input type="hidden" name="id" value={p.id} />
                            <button className="brand-heading text-xs text-agave hover:underline">
                              {NEXT_LABEL[p.status]}
                            </button>
                          </form>
                        )}
                        <form action={deletePost}>
                          <input type="hidden" name="id" value={p.id} />
                          <button className="text-xs text-slate/60 hover:text-burnt">Delete</button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>

        <Card title="Plan a post">
          <form action={createPost} className="space-y-3">
            <Field label="Working title">
              <input name="title" required placeholder="Paloma recipe reel — backyard table" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Target date">
                <input name="date" type="date" defaultValue={today} className={inputCls} />
              </Field>
              <Field label="Channel">
                <select name="channel" className={inputCls}>
                  {CHANNELS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Status">
              <select name="status" className={inputCls}>
                <option value="IDEA">Idea</option>
                <option value="DRAFTED">Drafted</option>
                <option value="SCHEDULED">Scheduled</option>
              </select>
            </Field>
            <Field label="Notes / caption ideas">
              <textarea name="notes" rows={3} className={inputCls} />
            </Field>
            <button className={btnCls}>Add to calendar</button>
            <p className="text-xs text-slate/70">
              Art direction cue from the playbook: the bottle already on the counter — food, prep, people. Something happening just outside the frame.
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
