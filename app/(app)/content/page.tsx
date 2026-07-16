import Link from "next/link";
import { headers } from "next/headers";
import { requireOps, getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Badge, Field, inputCls, btnCls, btnSecondaryCls, EmptyState, Callout } from "@/components/ui";
import { createPost, advancePost, approveProposed, deletePost } from "./actions";

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
  const me = await getCurrentUser();
  const { month } = await searchParams;
  const current = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : new Date().toISOString().slice(0, 7);

  const [year, mon] = current.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, mon - 1, 1));
  const monthEnd = new Date(Date.UTC(year, mon, 1));
  const prev = new Date(Date.UTC(year, mon - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 7);
  const monthName = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const [posts, proposed] = await Promise.all([
    db.socialPost.findMany({
      where: { approved: true, date: { gte: monthStart, lt: monthEnd } },
      orderBy: { date: "asc" },
    }),
    db.socialPost.findMany({
      where: { approved: false, source: "AGENT" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // month grid
  const firstDow = monthStart.getUTCDay();
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
  const contentKey = process.env.CONTENT_API_KEY;
  const apiEnabled = Boolean(contentKey);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "ops.denadatequila.com";
  const mcpUrl = `https://${host}/api/mcp/${contentKey ?? "YOUR_CONTENT_API_KEY"}`;

  return (
    <div>
      <PageHeader
        label="Marketing"
        title="Content Calendar"
        subtitle="Plan social posts and email sends: idea → drafted → scheduled → posted. The De Nada voice: warm, host-first, never flashy."
      />

      {proposed.length > 0 && (
        <Card title={`Proposed by your brand manager (${proposed.length})`}>
          <div className="space-y-3">
            {proposed.map((p) => (
              <div key={p.id} className="rounded-md border border-blanco/40 bg-blanco/15 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="blue">AI proposed</Badge>
                  <Badge>{chLabel(p.channel)}</Badge>
                  <span className="text-xs text-slate">{p.date.toISOString().slice(0, 10)}</span>
                  <span className="font-medium">{p.title}</span>
                </div>
                {p.caption && <p className="mt-2 whitespace-pre-wrap text-sm text-ink/85">{p.caption}</p>}
                {p.hashtags && <p className="mt-1 text-xs text-agave-deep">{p.hashtags}</p>}
                {p.assetUrl && (
                  <a href={p.assetUrl} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-agave-deep underline">
                    {p.assetUrl}
                  </a>
                )}
                {p.notes && <p className="mt-1 text-xs text-slate/80">{p.notes}</p>}
                <div className="mt-2 flex gap-2">
                  <form action={approveProposed}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className={btnCls}>Approve → calendar</button>
                  </form>
                  <form action={deletePost}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className={btnSecondaryCls}>Reject</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate/70">
            Your ChatGPT brand manager drafts these through the content API. They stay here until you approve — nothing reaches the live calendar unreviewed.
          </p>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
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
                    <div key={p.id} className="rounded-md border border-ink/8 bg-white/60 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="w-20 text-xs text-slate">{p.date.toISOString().slice(0, 10)}</div>
                        <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                        <Badge>{chLabel(p.channel)}</Badge>
                        {p.source === "AGENT" && <Badge tone="blue">AI</Badge>}
                        <div className="min-w-40 flex-1 text-sm font-medium">{p.title}</div>
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
                      {(p.caption || p.hashtags || p.assetUrl) && (
                        <div className="mt-1 pl-20 text-xs text-slate/80">
                          {p.caption && <p className="whitespace-pre-wrap">{p.caption}</p>}
                          {p.hashtags && <p className="text-agave-deep">{p.hashtags}</p>}
                          {p.assetUrl && (
                            <a href={p.assetUrl} target="_blank" rel="noreferrer" className="text-agave-deep underline">
                              {p.assetUrl}
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>

        <div className="space-y-6">
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
              <Field label="Caption">
                <textarea name="caption" rows={3} placeholder="Full caption in the De Nada voice" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Hashtags">
                  <input name="hashtags" placeholder="#DeNada #tequila" className={inputCls} />
                </Field>
                <Field label="Asset link">
                  <input name="assetUrl" placeholder="https://…" className={inputCls} />
                </Field>
              </div>
              <Field label="Art-direction notes">
                <textarea name="notes" rows={2} className={inputCls} />
              </Field>
              <button className={btnCls}>Add to calendar</button>
              <p className="text-xs text-slate/70">
                Art direction cue: the bottle already on the counter — food, prep, people. Something happening just outside the frame.
              </p>
            </form>
          </Card>

          {me?.role === "ADMIN" && (
            <Card title="Connect your ChatGPT brand manager">
              {apiEnabled ? (
                <div className="space-y-3 text-sm text-ink/85">
                  <p>The content API is <span className="font-medium text-agave-deep">on</span>.</p>
                  <div>
                    <p className="font-medium">ChatGPT Agent (connector / “New app”):</p>
                    <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs">
                      <li>In the agent&apos;s connector dialog, paste this as the <span className="font-medium">MCP Server URL</span>:</li>
                    </ol>
                    <p className="mt-1 break-all rounded-md bg-ink/5 p-2 font-mono text-[11px]">{mcpUrl}</p>
                    <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs" start={2}>
                      <li>Set Authentication to <span className="font-medium">No authentication</span> — the secret key is inside the URL, so treat the URL itself like a password.</li>
                      <li>The agent gets two tools: <span className="font-mono">list_posts</span> and <span className="font-mono">propose_post</span>. Proposals land above for your approval.</li>
                    </ol>
                  </div>
                  <div>
                    <p className="font-medium">Custom GPT (Actions) instead:</p>
                    <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs">
                      <li>Import the schema from <span className="font-mono">/api/content/openapi.json</span> on this domain.</li>
                      <li>Set Authentication → API Key → <span className="font-medium">Bearer</span>, and paste your <span className="font-mono">CONTENT_API_KEY</span>.</li>
                    </ol>
                  </div>
                </div>
              ) : (
                <p className="text-xs leading-relaxed text-slate/80">
                  To let your ChatGPT brand manager read the calendar and propose posts, set a
                  <span className="font-mono"> CONTENT_API_KEY</span> env var (any long random string) in Render.
                  Once set, this card shows the MCP server URL to paste into your ChatGPT Agent&apos;s
                  connector dialog. The key is scoped to content only — it can never reach financials,
                  the cap table, or customer data.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
