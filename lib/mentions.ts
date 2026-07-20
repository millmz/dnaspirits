import { db } from "./db";
import { getSetting, setSetting } from "./settings";

/**
 * Brand watch: a daily sweep of the public internet for De Nada mentions.
 * Three free sources, no accounts needed:
 *   - Google News RSS  → press, blogs, review sites
 *   - Reddit search    → the forum where tequila actually gets discussed
 *   - Bluesky search   → public social chatter
 * Results are deduped by URL into the Mention table; only genuinely new
 * finds are reported. Test override: MENTIONS_NEWS_URL / MENTIONS_REDDIT_URL /
 * MENTIONS_BSKY_URL point the fetchers at mock servers.
 */

const QUERY = `"de nada tequila"`;
const UA = { "User-Agent": "DeNadaOps/1.0 (+https://ops.denadatequila.com)" };
const TIMEOUT = AbortSignal.timeout.bind(AbortSignal);

/** Does this text actually talk about us — not just say "de nada" in Spanish? */
function isAboutUs(text: string): boolean {
  const t = text.toLowerCase();
  return t.includes("denadatequila") || (t.includes("de nada") && t.includes("tequila"));
}

export type Found = {
  url: string;
  source: "NEWS" | "REDDIT" | "BLUESKY";
  title: string;
  snippet: string;
  author: string;
  publishedAt: Date | null;
};

const strip = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#8217;|&rsquo;/g, "'")
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

async function fetchGoogleNews(): Promise<Found[]> {
  const base = process.env.MENTIONS_NEWS_URL || "https://news.google.com";
  const res = await fetch(`${base}/rss/search?q=${encodeURIComponent(QUERY)}&hl=en-US&gl=US&ceid=US:en`, {
    headers: UA,
    signal: TIMEOUT(12_000),
  });
  if (!res.ok) throw new Error(`news: HTTP ${res.status}`);
  const xml = await res.text();
  const out: Found[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const block = m[0];
    const pick = (tag: string) => {
      const t = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return t ? strip(t[1]) : "";
    };
    const title = pick("title");
    const link = pick("link");
    if (!title || !link || !isAboutUs(title + " " + pick("description"))) continue;
    const d = new Date(pick("pubDate"));
    out.push({
      url: link,
      source: "NEWS",
      title,
      snippet: pick("description").slice(0, 300),
      author: pick("source"),
      publishedAt: isNaN(d.getTime()) ? null : d,
    });
  }
  return out;
}

async function fetchReddit(): Promise<Found[]> {
  const base = process.env.MENTIONS_REDDIT_URL || "https://www.reddit.com";
  const res = await fetch(`${base}/search.json?q=${encodeURIComponent(QUERY)}&sort=new&limit=25&t=year`, {
    headers: UA,
    signal: TIMEOUT(12_000),
  });
  if (!res.ok) throw new Error(`reddit: HTTP ${res.status}`);
  const j = (await res.json()) as {
    data?: { children?: Array<{ data?: { permalink?: string; title?: string; selftext?: string; author?: string; subreddit?: string; created_utc?: number } }> };
  };
  const out: Found[] = [];
  for (const c of j.data?.children ?? []) {
    const d = c.data;
    if (!d?.permalink || !d.title) continue;
    if (!isAboutUs(`${d.title} ${d.selftext ?? ""}`)) continue;
    out.push({
      url: `https://www.reddit.com${d.permalink}`,
      source: "REDDIT",
      title: d.title,
      snippet: (d.selftext ?? "").slice(0, 300),
      author: d.subreddit ? `r/${d.subreddit} · u/${d.author ?? "?"}` : `u/${d.author ?? "?"}`,
      publishedAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
    });
  }
  return out;
}

async function fetchBluesky(): Promise<Found[]> {
  const base = process.env.MENTIONS_BSKY_URL || "https://public.api.bsky.app";
  const res = await fetch(`${base}/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(QUERY)}&limit=25`, {
    headers: UA,
    signal: TIMEOUT(12_000),
  });
  if (!res.ok) throw new Error(`bluesky: HTTP ${res.status}`);
  const j = (await res.json()) as {
    posts?: Array<{ uri?: string; author?: { handle?: string }; record?: { text?: string; createdAt?: string } }>;
  };
  const out: Found[] = [];
  for (const p of j.posts ?? []) {
    const text = p.record?.text ?? "";
    const rkey = p.uri?.split("/").pop();
    if (!rkey || !p.author?.handle || !isAboutUs(text)) continue;
    const d = new Date(p.record?.createdAt ?? "");
    out.push({
      url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
      source: "BLUESKY",
      title: text.slice(0, 120),
      snippet: text.slice(0, 300),
      author: `@${p.author.handle}`,
      publishedAt: isNaN(d.getTime()) ? null : d,
    });
  }
  return out;
}

export type ScanResult = { at: string; found: number; new: number; errors: string[] };

export async function runMentionScan(): Promise<ScanResult> {
  const settled = await Promise.allSettled([fetchGoogleNews(), fetchReddit(), fetchBluesky()]);
  const errors = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected").map((s) => String(s.reason?.message ?? s.reason));
  const found = settled.filter((s): s is PromiseFulfilledResult<Found[]> => s.status === "fulfilled").flatMap((s) => s.value);

  let fresh = 0;
  for (const f of found) {
    const existing = await db.mention.findUnique({ where: { url: f.url } });
    if (existing) continue;
    await db.mention.create({
      data: { url: f.url, source: f.source, title: f.title, snippet: f.snippet, author: f.author, publishedAt: f.publishedAt },
    });
    fresh++;
  }
  const result: ScanResult = { at: new Date().toISOString(), found: found.length, new: fresh, errors };
  await setSetting("mentions-last-scan", JSON.stringify(result));
  return result;
}

export async function getRecentMentions(limit = 12) {
  return db.mention.findMany({ orderBy: [{ foundAt: "desc" }, { publishedAt: "desc" }], take: limit });
}

export async function lastScan(): Promise<ScanResult | null> {
  try {
    const raw = await getSetting("mentions-last-scan");
    return raw ? (JSON.parse(raw) as ScanResult) : null;
  } catch {
    return null;
  }
}

/** Hourly tick; actually scans once a day. */
export async function mentionsWorkerTick(): Promise<void> {
  const last = await lastScan();
  if (last && Date.now() - new Date(last.at).getTime() < 20 * 60 * 60 * 1000) return;
  const r = await runMentionScan();
  console.log(`brand watch: ${r.found} mention(s) seen, ${r.new} new${r.errors.length ? ` · errors: ${r.errors.join("; ")}` : ""}`);
}
