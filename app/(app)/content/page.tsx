import Link from "next/link";
import { requireOps, getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Badge, Field, inputCls, btnCls, EmptyState, Callout } from "@/components/ui";
import { igConfigured, fbConfigured, appBaseUrl } from "@/lib/meta";
import { isVideo } from "@/lib/media";
import { createPost, advancePost, deletePost, publishNow, retryPublish } from "./actions";

const CHANNELS = [
  ["INSTAGRAM", "Instagram"],
  ["FACEBOOK", "Facebook"],
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
  searchParams: Promise<{ month?: string; err?: string }>;
}) {
  await requireOps();
  const me = await getCurrentUser();
  const { month, err } = await searchParams;
  const current = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : new Date().toISOString().slice(0, 7);

  const [year, mon] = current.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, mon - 1, 1));
  const monthEnd = new Date(Date.UTC(year, mon, 1));
  const prev = new Date(Date.UTC(year, mon - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 7);
  const monthName = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const posts = await db.socialPost.findMany({
    where: { date: { gte: monthStart, lt: monthEnd } },
    include: { media: true },
    orderBy: { date: "asc" },
  });

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
  const ig = igConfigured();
  const fb = fbConfigured();
  const metaOn = ig || fb;
  const baseUrl = appBaseUrl();

  return (
    <div>
      <PageHeader
        label="Marketing"
        title="Content Calendar"
        subtitle="Upload captions and media, schedule them, and let the platform post to Instagram and Facebook automatically. The De Nada voice: warm, host-first, never flashy."
      />

      <div className="mb-4 flex items-center gap-3">
        <Link href="/content/analytics" className="brand-heading text-sm text-agave hover:underline">
          View post analytics →
        </Link>
        {metaOn && (
          <span className="text-xs text-slate/70">
            Connected: {[ig && "Instagram", fb && "Facebook"].filter(Boolean).join(" + ")}
          </span>
        )}
      </div>

      {err && (
        <div className="mb-4">
          <Callout tone="red">{err}</Callout>
        </div>
      )}

      <div className="mt-2 grid gap-6 lg:grid-cols-3">
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
                        {p.media && (
                          isVideo(p.media.mime) ? (
                            <video src={`/media/${p.media.id}`} className="h-12 w-12 rounded-md object-cover" muted />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`/media/${p.media.id}`} alt="" className="h-12 w-12 rounded-md object-cover" />
                          )
                        )}
                        <div className="w-20 text-xs text-slate">{p.date.toISOString().slice(0, 10)}</div>
                        <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                        <Badge>{chLabel(p.channel)}</Badge>
                        {p.autoPublish && p.status === "SCHEDULED" && !p.publishError && (
                          <Badge tone="amber">{p.igCreationId ? "Processing…" : "Auto-post armed"}</Badge>
                        )}
                        {(p.igMediaId || p.fbPostId) && <Badge tone="green">Live on {p.igMediaId ? "IG" : "FB"}</Badge>}
                        <div className="min-w-40 flex-1 text-sm font-medium">{p.title}</div>
                        <div className="flex items-center gap-2">
                          {metaOn &&
                            p.status !== "POSTED" &&
                            (p.channel === "INSTAGRAM" || p.channel === "FACEBOOK") &&
                            !p.publishError && (
                              <form action={publishNow}>
                                <input type="hidden" name="id" value={p.id} />
                                <button className="brand-heading text-xs text-agave hover:underline">Publish now</button>
                              </form>
                            )}
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
                      {p.publishError && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
                          <span>Publish failed: {p.publishError}</span>
                          <form action={retryPublish}>
                            <input type="hidden" name="id" value={p.id} />
                            <button className="font-medium underline">Retry</button>
                          </form>
                        </div>
                      )}
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
                <Field label="Post date">
                  <input name="date" type="date" defaultValue={today} className={inputCls} />
                </Field>
                <Field label="Channel">
                  <select name="channel" className={inputCls}>
                    {CHANNELS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Status">
                <select name="status" className={inputCls} defaultValue="SCHEDULED">
                  <option value="IDEA">Idea</option>
                  <option value="DRAFTED">Drafted</option>
                  <option value="SCHEDULED">Scheduled</option>
                </select>
              </Field>
              <Field label="Photo / video">
                <input
                  name="media"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime"
                  className={inputCls}
                />
              </Field>
              <Field label="Caption">
                <textarea name="caption" rows={3} placeholder="Full caption in the De Nada voice" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Hashtags">
                  <input name="hashtags" placeholder="#DeNada #tequila" className={inputCls} />
                </Field>
                <Field label="External asset link (optional)">
                  <input name="assetUrl" placeholder="https://…" className={inputCls} />
                </Field>
              </div>
              <Field label="Art-direction notes">
                <textarea name="notes" rows={2} className={inputCls} />
              </Field>
              {metaOn && (
                <label className="flex items-center gap-2 text-sm text-ink/85">
                  <input type="checkbox" name="autoPublish" defaultChecked className="h-4 w-4 accent-agave" />
                  Auto-post to Instagram/Facebook on the post date
                </label>
              )}
              <button className={btnCls}>Add to calendar</button>
              <p className="text-xs text-slate/70">
                Scheduled posts with auto-post on go live within a minute of their date.
                Art direction cue: the bottle already on the counter — food, prep, people.
              </p>
            </form>
          </Card>

          {me?.role === "ADMIN" && (
            <Card title="Connect Instagram & Facebook">
              {metaOn ? (
                <div className="space-y-2 text-sm text-ink/85">
                  <p>
                    Meta is <span className="font-medium text-agave-deep">connected</span>
                    {" — "}{[ig && "Instagram", fb && "Facebook"].filter(Boolean).join(" and ")}.
                  </p>
                  {!baseUrl && (
                    <Callout tone="amber">
                      Set <span className="font-mono">APP_URL</span> (e.g. https://ops.denadatequila.com) so Meta can
                      download uploaded media when publishing.
                    </Callout>
                  )}
                  <p className="text-xs text-slate/70">
                    Scheduled posts publish automatically; analytics refresh twice a day (or on demand from the
                    analytics page).
                  </p>
                </div>
              ) : (
                <div className="space-y-2 text-xs leading-relaxed text-slate/80">
                  <p>To auto-publish and pull analytics, set these env vars in Render:</p>
                  <ul className="list-disc space-y-1 pl-4 font-mono">
                    <li>META_ACCESS_TOKEN</li>
                    <li>META_IG_USER_ID</li>
                    <li>META_FB_PAGE_ID</li>
                    <li>APP_URL</li>
                  </ul>
                  <p>
                    Get them from a Meta app (developers.facebook.com) connected to the De Nada Facebook Page and
                    Instagram professional account: generate a long-lived Page access token with
                    <span className="font-mono"> instagram_content_publish</span>,
                    <span className="font-mono"> pages_manage_posts</span>,
                    <span className="font-mono"> pages_read_engagement</span> and
                    <span className="font-mono"> instagram_manage_insights</span>. Ask Claude to walk you through it
                    step by step when you&apos;re ready.
                  </p>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
