import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { agentEnabled } from "./agent";
import { getSetting, setSetting } from "./settings";

/**
 * Content trends: what's working on TikTok, Reels, and the wider internet
 * right now — read through a spirits/CPG lens and turned into concrete
 * recommendations for De Nada's own content.
 *
 * TikTok and Instagram don't expose trend APIs, so the sweep reads the
 * signals that ARE public: Google's daily search trends, the creator-economy
 * and social-marketing trade press, cocktail-culture press, and Reddit's
 * marketing + drinks communities. An AI pass then crosses those signals with
 * De Nada's own post performance to produce specific, doable actions.
 *
 * Env: TREND_FEEDS overrides the feed list ("Source|url,Source|url");
 * TRENDS_REDDIT_URL points Reddit at a mock for tests.
 */

export type TrendItem = { source: string; title: string; link: string; date: string; relevance: number };
export type TrendRec = { title: string; insight: string; action: string };
export type TrendsBrief = { at: string; summary: string; trends: TrendRec[]; items: TrendItem[] };

const DEFAULT_FEEDS = [
  { source: "Google Trends", url: "https://trends.google.com/trending/rss?geo=US" },
  { source: "Tubefilter", url: "https://www.tubefilter.com/feed/" },
  { source: "Social Media Today", url: "https://www.socialmediatoday.com/feeds/news/" },
  { source: "Punch", url: "https://punchdrink.com/feed/" },
];

const REDDIT_SUBS = ["socialmediamarketing", "cocktails", "tequila"];

function feeds(): { source: string; url: string }[] {
  const raw = process.env.TREND_FEEDS;
  if (!raw) return DEFAULT_FEEDS;
  return raw
    .split(",")
    .map((p) => {
      const [source, ...rest] = p.split("|");
      return { source: source.trim(), url: rest.join("|").trim() };
    })
    .filter((f) => f.source && f.url);
}

const strip = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#8217;|&rsquo;/g, "'")
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const HOT = /tequila|agave|mezcal|cocktail|spirits|alcohol|drink|bartend|beverage|cpg|seltzer|margarita|paloma/i;
const WARM = /tiktok|reels?|instagram|short-form|shortform|creator|viral|trend|engagement|algorithm|video|ugc|influencer|meme|audio|sound|hashtag|caption|hook/i;

function score(text: string): number {
  let s = 0;
  if (HOT.test(text)) s += 3;
  if (WARM.test(text)) s += 1;
  return s;
}

async function fetchFeed(f: { source: string; url: string }): Promise<TrendItem[]> {
  const res = await fetch(f.url, {
    headers: { "User-Agent": "DeNadaOps/1.0 (+https://ops.denadatequila.com)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${f.source}: HTTP ${res.status}`);
  const xml = await res.text();
  const items: TrendItem[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const block = m[0];
    const pick = (tag: string) => {
      const t = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return t ? strip(t[1]) : "";
    };
    const title = pick("title");
    const link = pick("link");
    if (!title || !link) continue;
    const d = new Date(pick("pubDate") || pick("dc:date"));
    const text = `${title} ${pick("description")}`;
    // Google Trends items are raw search spikes — keep only drink/CPG-adjacent ones
    const rel = score(text);
    if (f.source === "Google Trends" && rel < 3) continue;
    items.push({
      source: f.source,
      title,
      link,
      date: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
      relevance: rel,
    });
  }
  return items;
}

async function fetchRedditTops(): Promise<TrendItem[]> {
  const base = process.env.TRENDS_REDDIT_URL || "https://www.reddit.com";
  const out: TrendItem[] = [];
  for (const sub of REDDIT_SUBS) {
    try {
      const res = await fetch(`${base}/r/${sub}/top.json?t=week&limit=12`, {
        headers: { "User-Agent": "DeNadaOps/1.0 (+https://ops.denadatequila.com)" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as {
        data?: { children?: Array<{ data?: { permalink?: string; title?: string; ups?: number; created_utc?: number } }> };
      };
      for (const c of j.data?.children ?? []) {
        const d = c.data;
        if (!d?.title || !d.permalink) continue;
        out.push({
          source: `r/${sub}`,
          title: d.title,
          link: `https://www.reddit.com${d.permalink}`,
          date: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : new Date().toISOString(),
          relevance: score(d.title) + (d.ups && d.ups > 500 ? 1 : 0),
        });
      }
    } catch {
      // one quiet subreddit shouldn't sink the sweep
    }
  }
  return out;
}

/** What has actually worked on De Nada's own accounts lately. */
async function ownPerformance(): Promise<string> {
  const [posts, accounts] = await Promise.all([
    db.socialPost.findMany({
      where: { status: "POSTED" },
      orderBy: { date: "desc" },
      take: 20,
      include: { metrics: { orderBy: { fetchedAt: "desc" }, take: 1 } },
    }),
    db.accountMetric.findMany({ orderBy: { fetchedAt: "desc" }, take: 4 }),
  ]);
  const rows = posts
    .map((p) => ({
      title: p.title,
      channel: p.channel,
      format: p.format,
      views: p.metrics[0]?.views ?? 0,
      reach: p.metrics[0]?.reach ?? 0,
      likes: p.metrics[0]?.likes ?? 0,
    }))
    .sort((a, b) => b.views - a.views || b.reach - a.reach);
  return JSON.stringify({
    followers: accounts.map((a) => ({ platform: a.platform, followers: a.followers })),
    topPosts: rows.slice(0, 6),
    weakPosts: rows.slice(-3),
  });
}

const TRENDS_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["summary", "trends"],
  properties: {
    summary: { type: "string" as const },
    trends: {
      type: "array" as const,
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["title", "insight", "action"],
        properties: {
          title: { type: "string" as const },
          insight: { type: "string" as const },
          action: { type: "string" as const },
        },
      },
    },
  },
};

export async function runTrendsRefresh(): Promise<TrendsBrief> {
  const [feedResults, reddit] = await Promise.all([Promise.allSettled(feeds().map(fetchFeed)), fetchRedditTops()]);
  const twoWeeksAgo = Date.now() - 14 * 86_400_000;
  const all: TrendItem[] = [...reddit];
  for (const r of feedResults) {
    if (r.status !== "fulfilled") {
      console.warn("trends: feed failed:", (r.reason as Error)?.message);
      continue;
    }
    for (const item of r.value) if (new Date(item.date).getTime() >= twoWeeksAgo) all.push(item);
  }
  all.sort((a, b) => b.relevance - a.relevance || b.date.localeCompare(a.date));
  const items = all.filter((i) => i.relevance >= 1).slice(0, 30);

  let summary = "";
  let trends: TrendRec[] = [];
  if (agentEnabled() && items.length > 0) {
    try {
      const client = new Anthropic();
      const resp = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 1800,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: { type: "json_schema", schema: TRENDS_SCHEMA } },
        system:
          "You are the content strategist for De Nada Tequila — a premium, additive-free tequila brand " +
          "with a warm, host-first voice. From the trend signals below (creator-economy press, search " +
          "spikes, cocktail culture, marketing communities) and the brand's own recent post performance, " +
          "produce: a 2-3 sentence summary of what's working in short-form right now for spirits/CPG " +
          "brands, and 3-5 trends worth leaning into. For each trend: title (short name), insight (why " +
          "it works, tied to the evidence), action (a specific post or series De Nada could shoot this " +
          "week — concrete format, hook, and angle; reference their top-performing content where " +
          "relevant). Stay within alcohol-marketing norms: 21+, no health claims, drink-responsibly " +
          "tone. Only build on signals actually present — never invent statistics.",
        messages: [
          {
            role: "user",
            content:
              `Trend signals:\n${items.map((i) => `- [${i.source}] ${i.title}`).join("\n")}\n\n` +
              `De Nada's own recent performance:\n${await ownPerformance()}`,
          },
        ],
      });
      const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      const parsed = JSON.parse(text) as { summary: string; trends: TrendRec[] };
      summary = parsed.summary;
      trends = parsed.trends ?? [];
    } catch (e) {
      console.error("trends: synthesis failed:", e);
    }
  }

  const brief: TrendsBrief = { at: new Date().toISOString(), summary, trends, items };
  if (items.length > 0) await setSetting("trends-brief", JSON.stringify(brief));
  return brief;
}

export async function getTrendsBrief(): Promise<TrendsBrief | null> {
  try {
    const raw = await getSetting("trends-brief");
    return raw ? (JSON.parse(raw) as TrendsBrief) : null;
  } catch {
    return null;
  }
}

/** Hourly worker hook: rebuild when the stored brief is stale (>20h). */
export async function trendsWorkerTick(): Promise<void> {
  const brief = await getTrendsBrief();
  if (brief && Date.now() - new Date(brief.at).getTime() < 20 * 60 * 60 * 1000) return;
  await runTrendsRefresh();
}
