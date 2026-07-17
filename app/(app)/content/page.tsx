import Link from "next/link";
import { requireOps, getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Badge, Field, inputCls, btnCls, EmptyState, Callout } from "@/components/ui";
import { igConfigured, fbConfigured, appBaseUrl } from "@/lib/meta";
import { isVideo } from "@/lib/media";
import { editPost, advancePost, deletePost, publishNow, retryPublish, removePostMedia, movePostMedia } from "./actions";
import { PostComposer, AddMedia } from "@/components/post-composer";

const CHANNELS = [
  ["IG_FB", "Instagram + Facebook"],
  ["INSTAGRAM", "Instagram"],
  ["FACEBOOK", "Facebook"],
  ["TIKTOK", "TikTok"],
  ["YOUTUBE", "YouTube"],
  ["EMAIL", "Email"],
  ["OTHER", "Other"],
] as const;

const META_CHANNELS = ["INSTAGRAM", "FACEBOOK", "IG_FB"];

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

const DOT_TONE: Record<string, string> = {
  POSTED: "bg-agave",
  SCHEDULED: "bg-reposado",
  DRAFTED: "bg-slate/60",
  IDEA: "bg-ink/25",
};

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; day?: string; edit?: string; err?: string }>;
}) {
  await requireOps();
  const me = await getCurrentUser();
  const { month, day, edit, err } = await searchParams;
  const current = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : new Date().toISOString().slice(0, 7);
  const selectedDay = /^\d{1,2}$/.test(day ?? "") ? Number(day) : null;

  const [year, mon] = current.split("-").map(Number);
  // all date math in server-local time (set TZ=America/New_York in Render so
  // scheduling times mean Eastern) — display and grouping stay consistent
  const monthStart = new Date(year, mon - 1, 1);
  const monthEnd = new Date(year, mon, 1);
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prev = ym(new Date(year, mon - 2, 1));
  const next = ym(new Date(year, mon, 1));
  const monthName = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const posts = await db.socialPost.findMany({
    where: { date: { gte: monthStart, lt: monthEnd } },
    include: { items: { orderBy: { position: "asc" } } },
    orderBy: { date: "asc" },
  });

  // month grid
  const firstDow = monthStart.getDay();
  const daysInMonth = new Date(year, mon, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const byDay = new Map<number, typeof posts>();
  for (const p of posts) {
    const d = p.date.getDate();
    byDay.set(d, [...(byDay.get(d) ?? []), p]);
  }

  const visiblePosts = selectedDay ? posts.filter((p) => p.date.getDate() === selectedDay) : posts;

  const pad = (n: number) => String(n).padStart(2, "0");
  const toLocalInput = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const showWhen = (d: Date) =>
    d.getHours() === 0 && d.getMinutes() === 0
      ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
        " · " +
        d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const defaultDatetime = selectedDay
    ? `${current}-${pad(selectedDay)}T09:00`
    : toLocalInput(new Date(Date.now() + 60 * 60 * 1000));
  const editingPost = edit ? await db.socialPost.findUnique({ where: { id: edit } }) : null;

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
              {cells.map((d, i) => {
                if (!d) return <div key={i} className="min-h-12 bg-white/80 p-1 sm:min-h-20 sm:p-1.5" />;
                const dayPosts = byDay.get(d) ?? [];
                const isSelected = selectedDay === d;
                return (
                  <Link
                    key={i}
                    href={isSelected ? `/content?month=${current}` : `/content?month=${current}&day=${d}`}
                    className={`block min-h-12 bg-white/80 p-1 transition-colors hover:bg-blanco/20 sm:min-h-20 sm:p-1.5 ${
                      isSelected ? "ring-2 ring-inset ring-agave" : ""
                    }`}
                  >
                    <div className="mb-1 text-[10px] font-medium text-slate/60">{d}</div>
                    {/* desktop: title chips */}
                    <div className="hidden sm:block">
                      {dayPosts.map((p) => (
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
                    </div>
                    {/* mobile: status dots */}
                    <div className="flex flex-wrap gap-0.5 sm:hidden">
                      {dayPosts.slice(0, 4).map((p) => (
                        <span key={p.id} className={`h-1.5 w-1.5 rounded-full ${DOT_TONE[p.status] ?? "bg-ink/25"}`} />
                      ))}
                      {dayPosts.length > 4 && <span className="text-[8px] leading-none text-slate/70">+{dayPosts.length - 4}</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>

          <div className="mt-6">
            <Card
              title={
                selectedDay
                  ? `Posts on ${monthName.split(" ")[0]} ${selectedDay}`
                  : `Posts in ${monthName}`
              }
            >
              {selectedDay && (
                <Link href={`/content?month=${current}`} className="brand-heading mb-3 inline-block text-xs text-agave hover:underline">
                  ← Show the whole month
                </Link>
              )}
              {visiblePosts.length === 0 ? (
                <EmptyState>
                  {selectedDay ? "Nothing planned this day." : "Nothing planned this month yet."}
                </EmptyState>
              ) : (
                <div className="space-y-2">
                  {visiblePosts.map((p) => (
                    <div key={p.id} className="rounded-md border border-ink/8 bg-white/60 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="w-24 text-xs text-slate">{showWhen(p.date)}</div>
                        <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                        <Badge>{chLabel(p.channel)}</Badge>
                        {p.items.length > 1 && <Badge tone="blue">Carousel · {p.items.length}</Badge>}
                        {p.autoPublish && p.status === "SCHEDULED" && !p.publishError && (
                          <Badge tone="amber">{p.igCreationId || p.igChildIds ? "Processing…" : "Auto-post armed"}</Badge>
                        )}
                        {(p.igMediaId || p.fbPostId) && (
                          <Badge tone="green">
                            Live on {[p.igMediaId && "IG", p.fbPostId && "FB"].filter(Boolean).join(" + ")}
                          </Badge>
                        )}
                        <div className="min-w-40 flex-1 text-sm font-medium">{p.title}</div>
                        <div className="flex items-center gap-2">
                          {metaOn &&
                            p.status !== "POSTED" &&
                            META_CHANNELS.includes(p.channel) &&
                            !p.publishError && (
                              <form action={publishNow}>
                                <input type="hidden" name="id" value={p.id} />
                                <button className="brand-heading px-1 py-1.5 text-xs text-agave hover:underline">Publish now</button>
                              </form>
                            )}
                          {p.status !== "POSTED" && (
                            <Link href={`/content?month=${current}&edit=${p.id}#plan`} className="brand-heading px-1 py-1.5 text-xs text-agave hover:underline">
                              Edit
                            </Link>
                          )}
                          {p.igPermalink && (
                            <a href={p.igPermalink} target="_blank" rel="noreferrer" className="brand-heading px-1 py-1.5 text-xs text-agave-deep hover:underline">
                              View on IG
                            </a>
                          )}
                          {p.fbPostId && (
                            <a href={`https://www.facebook.com/${p.fbPostId}`} target="_blank" rel="noreferrer" className="brand-heading px-1 py-1.5 text-xs text-agave-deep hover:underline">
                              View on FB
                            </a>
                          )}
                          {p.status !== "POSTED" && (
                            <form action={advancePost}>
                              <input type="hidden" name="id" value={p.id} />
                              <button className="brand-heading px-1 py-1.5 text-xs text-agave hover:underline">
                                {NEXT_LABEL[p.status]}
                              </button>
                            </form>
                          )}
                          <form action={deletePost}>
                            <input type="hidden" name="id" value={p.id} />
                            <button className="px-1 py-1.5 text-xs text-slate/60 hover:text-burnt">Delete</button>
                          </form>
                        </div>
                      </div>
                      {(p.items.length > 0 || p.status !== "POSTED") && (
                        <div className="mt-2 flex flex-wrap items-end gap-2 sm:pl-20">
                          {p.items.map((it, idx) => (
                            <div key={it.id} className="group relative">
                              {isVideo(it.mime) ? (
                                <video src={`/media/${it.id}`} className="h-16 w-16 rounded-md border border-ink/10 object-cover" muted />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={`/media/${it.id}`} alt="" className="h-16 w-16 rounded-md border border-ink/10 object-cover" />
                              )}
                              <span className="absolute left-0.5 top-0.5 rounded-sm bg-ink/70 px-1 text-[9px] font-medium text-white">
                                {idx === 0 ? "cover" : idx + 1}
                              </span>
                              {isVideo(it.mime) && (
                                <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-ink/70 px-1 text-[9px] text-white">▶</span>
                              )}
                              {p.status !== "POSTED" && (
                                <div className="mt-0.5 flex justify-center gap-0.5">
                                  {idx > 0 && (
                                    <form action={movePostMedia}>
                                      <input type="hidden" name="assetId" value={it.id} />
                                      <input type="hidden" name="dir" value="left" />
                                      <button className="flex h-7 w-7 items-center justify-center rounded text-xs text-slate/70 hover:text-agave sm:h-5 sm:w-5 sm:text-[10px]" title="Move earlier">◀</button>
                                    </form>
                                  )}
                                  <form action={removePostMedia}>
                                    <input type="hidden" name="assetId" value={it.id} />
                                    <button className="flex h-7 w-7 items-center justify-center rounded text-xs text-slate/70 hover:text-burnt sm:h-5 sm:w-5 sm:text-[10px]" title="Remove">✕</button>
                                  </form>
                                  {idx < p.items.length - 1 && (
                                    <form action={movePostMedia}>
                                      <input type="hidden" name="assetId" value={it.id} />
                                      <input type="hidden" name="dir" value="right" />
                                      <button className="flex h-7 w-7 items-center justify-center rounded text-xs text-slate/70 hover:text-agave sm:h-5 sm:w-5 sm:text-[10px]" title="Move later">▶</button>
                                    </form>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                          {p.status !== "POSTED" && p.items.length < 10 && (
                            <AddMedia postId={p.id} room={10 - p.items.length} />
                          )}
                        </div>
                      )}
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
                        <div className="mt-1 text-xs text-slate/80 sm:pl-20">
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

        <div id="plan" className="scroll-mt-20 space-y-6">
          <Card title={editingPost ? `Edit “${editingPost.title}”` : "Plan a post"}>
            {editingPost ? (
            <form action={editPost} className="space-y-3">
              <input type="hidden" name="id" value={editingPost.id} />
              <Field label="Working title">
                <input
                  name="title"
                  required
                  defaultValue={editingPost.title}
                  placeholder="Paloma recipe reel — backyard table"
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Post date & time">
                  <input
                    name="datetime"
                    type="datetime-local"
                    defaultValue={toLocalInput(editingPost.date)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Channel">
                  <select name="channel" className={inputCls} defaultValue={editingPost.channel}>
                    {CHANNELS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Caption">
                <textarea name="caption" rows={3} defaultValue={editingPost.caption} placeholder="Full caption in the De Nada voice" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Hashtags">
                  <input name="hashtags" defaultValue={editingPost.hashtags} placeholder="#DeNada #tequila" className={inputCls} />
                </Field>
                <Field label="External asset link (optional)">
                  <input name="assetUrl" defaultValue={editingPost.assetUrl} placeholder="https://…" className={inputCls} />
                </Field>
              </div>
              <Field label="Art-direction notes">
                <textarea name="notes" rows={2} defaultValue={editingPost.notes} className={inputCls} />
              </Field>
              {metaOn && (
                <label className="flex items-center gap-2 text-sm text-ink/85">
                  <input
                    type="checkbox"
                    name="autoPublish"
                    defaultChecked={editingPost.autoPublish}
                    className="h-4 w-4 accent-agave"
                  />
                  Auto-post to Instagram/Facebook at the scheduled time
                </label>
              )}
              <div className="flex items-center gap-3">
                <button className={btnCls}>Save changes</button>
                <Link href={`/content?month=${current}`} className="text-sm text-slate underline-offset-2 hover:underline">
                  Cancel
                </Link>
              </div>
            </form>
            ) : (
              <PostComposer
                channels={CHANNELS.map(([k, label]) => [k, label])}
                defaultChannel={ig && fb ? "IG_FB" : "INSTAGRAM"}
                defaultDatetime={defaultDatetime}
                metaOn={metaOn}
              />
            )}
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

      {/* mobile: floating new-post button, jumps to the composer */}
      <a
        href="#plan"
        aria-label="New post"
        className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-agave text-cream shadow-xl transition-transform active:scale-95 lg:hidden"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </a>
    </div>
  );
}
