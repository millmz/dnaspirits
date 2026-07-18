import Link from "next/link";
import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Stat, Table, Td, Badge, EmptyState, Callout, btnCls } from "@/components/ui";
import { BarChart } from "@/components/charts";
import { num } from "@/lib/format";
import { metaConfigured } from "@/lib/meta";
import { refreshMetrics } from "../actions";

/**
 * Post analytics: KPIs from the latest Meta insights snapshot of every
 * published post. History stays in PostMetric, so trends can be added later.
 */
export default async function ContentAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; err?: string }>;
}) {
  await requireOps();
  const { updated, err } = await searchParams;

  const [posts, accountSnaps] = await Promise.all([
    db.socialPost.findMany({
      where: { status: "POSTED", metrics: { some: {} } },
      include: {
        metrics: { orderBy: { fetchedAt: "desc" } },
        items: { select: { mime: true }, orderBy: { position: "asc" } },
      },
      orderBy: { date: "desc" },
      take: 200,
    }),
    db.accountMetric.findMany({ orderBy: { fetchedAt: "asc" }, take: 400 }),
  ]);

  // account-level: latest snapshot per platform + IG follower trend by day
  const latestAccount = new Map<string, (typeof accountSnaps)[number]>();
  for (const s of accountSnaps) latestAccount.set(s.platform, s);
  const igFollowerByDay = new Map<string, number>();
  for (const s of accountSnaps) {
    if (s.platform === "INSTAGRAM" && s.followers > 0) {
      igFollowerByDay.set(s.fetchedAt.toISOString().slice(0, 10), s.followers);
    }
  }
  const followerDays = [...igFollowerByDay.keys()].sort().slice(-14);

  const postFormat = (p: (typeof posts)[number]): string => {
    if (p.format === "STORY") return "Story";
    if (p.items.length > 1) return "Carousel";
    if (p.items.length === 1) return p.items[0].mime.startsWith("video/") ? "Reel" : "Photo";
    return "Imported";
  };

  // one latest snapshot per platform per post
  const rows = posts.flatMap((p) => {
    const seen = new Set<string>();
    const latest = p.metrics.filter((m) => {
      if (seen.has(m.platform)) return false;
      seen.add(m.platform);
      return true;
    });
    return latest.map((m) => ({ post: p, m }));
  });

  // daily trend: for each snapshot day, the summed latest-known views/reach per post+platform
  const byDay = new Map<string, Map<string, { views: number; reach: number }>>();
  const allSnaps = posts
    .flatMap((p) => p.metrics.map((m) => ({ ...m, postKey: `${p.id}|${m.platform}` })))
    .sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const runningLatest = new Map<string, { views: number; reach: number }>();
  for (const m of allSnaps) {
    runningLatest.set(m.postKey, { views: m.views, reach: m.reach });
    const dayKey = m.fetchedAt.toISOString().slice(0, 10);
    byDay.set(dayKey, new Map(runningLatest));
  }
  const trendDays = [...byDay.keys()].sort().slice(-14);
  const trend = trendDays.map((d) => {
    const snapshot = byDay.get(d)!;
    let views = 0;
    let reach = 0;
    for (const v of snapshot.values()) {
      views += v.views;
      reach += v.reach;
    }
    return { day: d.slice(5), views, reach };
  });

  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const totals = {
    views: sum((r) => r.m.views),
    reach: sum((r) => r.m.reach),
    likes: sum((r) => r.m.likes),
    comments: sum((r) => r.m.comments),
    shares: sum((r) => r.m.shares),
    saves: sum((r) => r.m.saves),
  };
  const interactions = totals.likes + totals.comments + totals.shares + totals.saves;
  const engagement = totals.reach > 0 ? ((interactions / totals.reach) * 100).toFixed(1) + "%" : "—";
  const lastFetched = rows.length
    ? rows.reduce((a, r) => (r.m.fetchedAt > a ? r.m.fetchedAt : a), rows[0].m.fetchedAt)
    : null;

  // per-row engagement rate + groupings for the "what works" section
  const er = (m: (typeof rows)[number]["m"]) =>
    m.reach > 0 ? (m.likes + m.comments + m.shares + m.saves) / m.reach : null;
  const scored = rows
    .map((r) => ({ ...r, er: er(r.m) }))
    .filter((r): r is (typeof rows)[number] & { er: number } => r.er !== null && r.m.reach >= 10);
  const topPosts = [...scored].sort((a, b) => b.er - a.er).slice(0, 8);

  const groupAvg = (keyOf: (r: (typeof scored)[number]) => string) => {
    const groups = new Map<string, { er: number; reach: number; n: number }>();
    for (const r of scored) {
      const k = keyOf(r);
      const g = groups.get(k) ?? { er: 0, reach: 0, n: 0 };
      g.er += r.er;
      g.reach += r.m.reach;
      g.n++;
      groups.set(k, g);
    }
    return [...groups.entries()]
      .map(([k, g]) => ({ key: k, avgEr: g.er / g.n, avgReach: Math.round(g.reach / g.n), n: g.n }))
      .sort((a, b) => b.avgEr - a.avgEr);
  };
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const SLOTS: [string, number, number][] = [["morning (5–11am)", 5, 11], ["midday (11am–3pm)", 11, 15], ["afternoon (3–7pm)", 15, 19], ["evening (7pm–12)", 19, 24], ["late night", 0, 5]];
  const slotOf = (h: number) => SLOTS.find(([, a, b]) => h >= a && h < b)?.[0] ?? "late night";
  const byFormat = groupAvg((r) => postFormat(r.post));
  const byWeekday = groupAvg((r) => WEEKDAYS[r.post.date.getDay()]);
  const bySlot = groupAvg((r) => slotOf(r.post.date.getHours()));
  const bestDay = byWeekday.find((g) => g.n >= 3);
  const bestSlot = bySlot.find((g) => g.n >= 3);
  const pct = (v: number) => (v * 100).toFixed(1) + "%";

  /** Tiny inline views-over-time sparkline from a post's snapshots. */
  const sparkline = (post: (typeof posts)[number], platform: string) => {
    const snaps = post.metrics.filter((m) => m.platform === platform).slice(0, 12).reverse();
    if (snaps.length < 2) return null;
    const vals = snaps.map((s) => s.views);
    const max = Math.max(...vals, 1);
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 60},${14 - (v / max) * 12}`).join(" ");
    return (
      <svg width="60" height="16" className="inline-block align-middle">
        <polyline points={pts} fill="none" stroke="#018769" strokeWidth="1.5" />
      </svg>
    );
  };

  return (
    <div>
      <PageHeader
        label="Marketing"
        title="Post Analytics"
        subtitle="Views, reach and engagement for everything published to Instagram and Facebook — refreshed twice a day."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/content" className="brand-heading text-sm text-agave hover:underline">← Back to calendar</Link>
        {metaConfigured() && (
          <form action={refreshMetrics}>
            <button className={btnCls}>Refresh analytics now</button>
          </form>
        )}
        {lastFetched && (
          <span className="text-xs text-slate/70">Last fetched {lastFetched.toISOString().replace("T", " ").slice(0, 16)} UTC</span>
        )}
      </div>

      {updated && (
        <div className="mb-4">
          <Callout tone="green">Refreshed metrics for {updated} post{updated === "1" ? "" : "s"}.</Callout>
        </div>
      )}
      {err && (
        <div className="mb-4">
          <Callout tone="amber">{err}</Callout>
        </div>
      )}

      {latestAccount.size > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="IG followers" value={num(latestAccount.get("INSTAGRAM")?.followers ?? 0)} tone="agave" />
          <Stat label="FB followers" value={num(latestAccount.get("FACEBOOK")?.followers ?? 0)} />
          <Stat label="IG reach (day)" value={num(latestAccount.get("INSTAGRAM")?.reach ?? 0)} hint="unique accounts reached" />
          <Stat label="IG profile views (day)" value={num(latestAccount.get("INSTAGRAM")?.profileViews ?? 0)} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="Views" value={num(totals.views)} />
        <Stat label="Reach" value={num(totals.reach)} />
        <Stat label="Likes" value={num(totals.likes)} />
        <Stat label="Comments" value={num(totals.comments)} />
        <Stat label="Shares" value={num(totals.shares)} />
        <Stat label="Saves" value={num(totals.saves)} />
        <Stat label="Engagement" value={engagement} hint="interactions ÷ reach" tone="agave" />
      </div>

      {followerDays.length >= 2 && (
        <div className="mt-6">
          <Card title="Instagram follower growth">
            <BarChart
              groups={followerDays.map((d) => d.slice(5))}
              series={[{ label: "Followers", color: "#018769", values: followerDays.map((d) => igFollowerByDay.get(d) ?? 0) }]}
            />
          </Card>
        </div>
      )}

      {scored.length > 0 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="Top posts by engagement rate">
            <Table headers={["Post", "Format", "Engagement", "Reach"]} align={["left", "left", "right", "right"]}>
              {topPosts.map((r) => (
                <tr key={r.m.id}>
                  <Td>
                    <span className="line-clamp-1">{r.post.title}</span>
                  </Td>
                  <Td><Badge tone="blue">{postFormat(r.post)}</Badge></Td>
                  <Td right><span className="font-medium text-agave-deep">{pct(r.er)}</span></Td>
                  <Td right>{num(r.m.reach)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="What works">
            {bestDay && bestSlot ? (
              <Callout tone="green">
                Best pattern so far: <span className="font-medium">{bestDay.key}s</span>, {bestSlot.key} —
                schedule your strongest content there.
              </Callout>
            ) : (
              <Callout tone="amber">Keep posting — after ~10 posts this section can tell you the best day and time.</Callout>
            )}
            <Table headers={["By format", "Posts", "Avg engagement", "Avg reach"]} align={["left", "right", "right", "right"]}>
              {byFormat.map((g) => (
                <tr key={g.key}>
                  <Td>{g.key}</Td>
                  <Td right>{g.n}</Td>
                  <Td right>{pct(g.avgEr)}</Td>
                  <Td right>{num(g.avgReach)}</Td>
                </tr>
              ))}
            </Table>
            <div className="mt-3">
              <Table headers={["By day", "Posts", "Avg engagement"]} align={["left", "right", "right"]}>
                {byWeekday.map((g) => (
                  <tr key={g.key}>
                    <Td>{g.key}</Td>
                    <Td right>{g.n}</Td>
                    <Td right>{pct(g.avgEr)}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          </Card>
        </div>
      )}

      {trend.length >= 2 && (
        <div className="mt-6">
          <Card title="Reach & views over time (all published posts)">
            <BarChart
              groups={trend.map((t) => t.day)}
              series={[
                { label: "Views", color: "#231F20", values: trend.map((t) => t.views) },
                { label: "Reach", color: "#018769", values: trend.map((t) => t.reach) },
              ]}
            />
            <p className="mt-3 text-xs text-slate/70">
              Totals across every published post at each analytics refresh — the growth curve of your
              content overall, refreshed twice a day.
            </p>
          </Card>
        </div>
      )}

      <div className="mt-6">
        <Card title={`Published posts (${rows.length})`}>
          {rows.length === 0 ? (
            <EmptyState>
              No analytics yet. Publish a post to Instagram or Facebook from the calendar and metrics will appear
              here after the next refresh.
            </EmptyState>
          ) : (
            <Table
              headers={["Date", "Platform", "Post", "Trend", "Views", "Reach", "Likes", "Comments", "Shares", "Saves"]}
              align={["left", "left", "left", "left", "right", "right", "right", "right", "right", "right"]}
            >
              {rows.map(({ post, m }) => (
                <tr key={m.id}>
                  <Td>{post.date.toISOString().slice(0, 10)}</Td>
                  <Td>
                    {m.platform === "INSTAGRAM" && post.igPermalink ? (
                      <a href={post.igPermalink} target="_blank" rel="noreferrer" className="hover:underline">
                        <Badge tone="blue">Instagram ↗</Badge>
                      </a>
                    ) : m.platform === "FACEBOOK" && post.fbPostId ? (
                      <a href={`https://www.facebook.com/${post.fbPostId}`} target="_blank" rel="noreferrer" className="hover:underline">
                        <Badge>Facebook ↗</Badge>
                      </a>
                    ) : (
                      <Badge tone={m.platform === "INSTAGRAM" ? "blue" : "gray"}>{m.platform === "INSTAGRAM" ? "Instagram" : "Facebook"}</Badge>
                    )}
                  </Td>
                  <Td>{post.title}</Td>
                  <Td>{sparkline(post, m.platform) ?? <span className="text-xs text-slate/40">—</span>}</Td>
                  <Td right>{num(m.views)}</Td>
                  <Td right>{num(m.reach)}</Td>
                  <Td right>{num(m.likes)}</Td>
                  <Td right>{num(m.comments)}</Td>
                  <Td right>{num(m.shares)}</Td>
                  <Td right>{num(m.saves)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
