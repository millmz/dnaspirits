import Anthropic from "@anthropic-ai/sdk";
import { agentEnabled } from "./agent";
import { getSetting, setSetting } from "./settings";

/**
 * Daily industry brief: pulls RSS from the trade press, scores items for
 * tequila/agave relevance, and (when the AI key is set) writes a 2-3
 * sentence summary for the dashboard. Feeds are overridable via NEWS_FEEDS
 * ("Source|https://url,Source|https://url"). Every feed failure is
 * tolerated — a broken outlet never blanks the brief.
 */

const DEFAULT_FEEDS: { source: string; url: string }[] = [
  { source: "Shanken News Daily", url: "https://www.shankennewsdaily.com/feed/" },
  { source: "The Spirits Business", url: "https://www.thespiritsbusiness.com/feed/" },
  { source: "Just Drinks", url: "https://www.just-drinks.com/feed/" },
  { source: "VinePair", url: "https://vinepair.com/feed/" },
];

function feeds(): { source: string; url: string }[] {
  const env = process.env.NEWS_FEEDS;
  if (!env) return DEFAULT_FEEDS;
  return env
    .split(",")
    .map((pair) => {
      const i = pair.indexOf("|");
      return i > 0 ? { source: pair.slice(0, i).trim(), url: pair.slice(i + 1).trim() } : null;
    })
    .filter((f): f is { source: string; url: string } => !!f);
}

export type NewsItem = {
  source: string;
  title: string;
  link: string;
  date: string; // ISO
  relevance: number; // higher = more tequila/agave-specific
};

export type NewsBrief = { at: string; summary: string; items: NewsItem[] };

const strip = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#821[12];|&mdash;|&ndash;/g, "—")
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

function parseRss(xml: string, source: string): Omit<NewsItem, "relevance">[] {
  const items: Omit<NewsItem, "relevance">[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const block = m[0];
    const pick = (tag: string) => {
      const t = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return t ? strip(t[1]) : "";
    };
    const title = pick("title");
    const link = pick("link") || (block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "");
    const pub = pick("pubDate") || pick("dc:date");
    const d = new Date(pub);
    if (!title || !link) continue;
    items.push({ source, title, link, date: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString() });
  }
  return items;
}

const HOT = /tequila|agave|mezcal/i;
const WARM = /spirits|whiskey|whisky|vodka|rum|distill|rtd|ready-to-drink|premium|importer|distributor|three-tier|tariff|abv|liquor/i;

function score(title: string): number {
  let s = 0;
  if (HOT.test(title)) s += 3;
  if (WARM.test(title)) s += 1;
  return s;
}

async function fetchFeed(f: { source: string; url: string }): Promise<Omit<NewsItem, "relevance">[]> {
  const res = await fetch(f.url, {
    headers: { "User-Agent": "DeNadaOps/1.0 (+https://ops.denadatequila.com)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${f.source}: HTTP ${res.status}`);
  return parseRss(await res.text(), f.source);
}

/** Pull all feeds, rank, summarize, store. Returns the fresh brief. */
export async function runNewsRefresh(): Promise<NewsBrief> {
  const results = await Promise.allSettled(feeds().map(fetchFeed));
  const weekAgo = Date.now() - 7 * 86_400_000;
  const all: NewsItem[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") {
      console.warn("news: feed failed:", (r.reason as Error)?.message);
      continue;
    }
    for (const item of r.value) {
      if (new Date(item.date).getTime() < weekAgo) continue;
      all.push({ ...item, relevance: score(item.title) });
    }
  }
  all.sort((a, b) => b.relevance - a.relevance || b.date.localeCompare(a.date));
  const items = all.slice(0, 8);

  let summary = "";
  if (agentEnabled() && items.length > 0) {
    try {
      const client = new Anthropic();
      const resp = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 500,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        system:
          "You write a 2-3 sentence morning brief for the founders of a premium tequila brand, from " +
          "trade-press headlines. Lead with whatever matters most to a tequila/agave business, then " +
          "the broader spirits picture. Plain text, warm and direct, no markdown, no preamble. Only " +
          "reference what's actually in the headlines — never invent facts or numbers.",
        messages: [
          { role: "user", content: items.map((i) => `- [${i.source}] ${i.title}`).join("\n") },
        ],
      });
      summary = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    } catch (e) {
      console.error("news: summary failed:", e);
    }
  }

  const brief: NewsBrief = { at: new Date().toISOString(), summary, items };
  if (items.length > 0) await setSetting("news-brief", JSON.stringify(brief));
  return brief;
}

export async function getNewsBrief(): Promise<NewsBrief | null> {
  try {
    const raw = await getSetting("news-brief");
    return raw ? (JSON.parse(raw) as NewsBrief) : null;
  } catch {
    return null;
  }
}

/** Hourly worker hook: refresh when the stored brief is stale (>12h). */
export async function newsWorkerTick(): Promise<void> {
  const brief = await getNewsBrief();
  if (brief && Date.now() - new Date(brief.at).getTime() < 12 * 60 * 60 * 1000) return;
  await runNewsRefresh();
}
