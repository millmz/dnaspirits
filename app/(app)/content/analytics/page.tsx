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

  const posts = await db.socialPost.findMany({
    where: { status: "POSTED", metrics: { some: {} } },
    include: { metrics: { orderBy: { fetchedAt: "desc" } } },
    orderBy: { date: "desc" },
    take: 200,
  });

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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="Views" value={num(totals.views)} />
        <Stat label="Reach" value={num(totals.reach)} />
        <Stat label="Likes" value={num(totals.likes)} />
        <Stat label="Comments" value={num(totals.comments)} />
        <Stat label="Shares" value={num(totals.shares)} />
        <Stat label="Saves" value={num(totals.saves)} />
        <Stat label="Engagement" value={engagement} hint="interactions ÷ reach" tone="agave" />
      </div>

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
              headers={["Date", "Platform", "Post", "Views", "Reach", "Likes", "Comments", "Shares", "Saves"]}
              align={["left", "left", "left", "right", "right", "right", "right", "right", "right"]}
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
