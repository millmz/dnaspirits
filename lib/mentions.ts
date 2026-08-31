import { db } from "./db";
import { getSetting, setSetting } from "./settings";

/**
 * Brand watch: a daily sweep of the public internet for De Nada mentions.
 *   - Google News RSS  → press, blogs, review sites
 *   - Reddit           → the forums where tequila actually gets discussed:
 *                        site-wide search, searches restricted to spirits
 *                        subreddits, AND the comment threads underneath —
 *                        most real chatter is a reply, not a post
 *   - Bluesky search   → public social chatter
 * Results are deduped by URL into the Mention table; only genuinely new finds
 * are reported. Test override: MENTIONS_NEWS_URL / MENTIONS_REDDIT_URL /
 * MENTIONS_BSKY_URL point the fetchers at mock servers.
 *
 * Reddit rate-limits anonymous traffic hard and often blocks datacenter IPs
 * outright. Set REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET (a free "script" app
 * at reddit.com/prefs/apps) to authenticate and lift that ceiling; without
 * them the scan still runs anonymously, and any block is reported per-source
 * on the dashboard rather than looking like "nobody is talking about us".
 */

const UA = { "User-Agent": "DeNadaOps/1.0 (+https://ops.denadatequila.com)" };
const TIMEOUT = AbortSignal.timeout.bind(AbortSignal);

/** Forums where a bare "De Nada" is almost certainly the brand, not Spanish. */
const SUBREDDITS = [
  "tequila",
  "TequilaTalk",
  "cocktails",
  "bartenders",
  "liquor",
  "alcohol",
  "mixology",
  "Spirits",
];

/** Search phrasings people actually use. */
const QUERIES = [
  `"de nada tequila"`,
  `"de nada" tequila`,
  `denada tequila`,
  `denadatequila`,
  `"de nada blanco"`,
  `"de nada reposado"`,
];

const SPIRITS_WORDS =
  /tequila|agave|mezcal|blanco|reposado|a[ñn]ejo|bottle|pour|sip|liquor|spirit|cocktail|margarita|paloma|distiller/i;

/** A bare "de nada" reply is Spanish courtesy, not a brand mention. */
function isCourtesy(text: string): boolean {
  const t = text.toLowerCase().replace(/[!.,¡\s]+/g, " ").trim();
  if (/^de nada( amigo| amiga| señor| señora| friend)?$/.test(t)) return true;
  return /\bgracias\b[\s\S]{0,30}\bde nada\b/.test(t) || /\bde nada\b[\s\S]{0,20}\bgracias\b/.test(t);
}

/**
 * Does this text actually talk about us — not just say "de nada" in Spanish?
 * Inside a spirits forum the surrounding context IS the tequila signal, so a
 * mention there doesn't have to repeat the word "tequila" — which is exactly
 * the chatter the old strict filter was throwing away.
 */
export function isAboutUs(text: string, opts: { forumContext?: boolean } = {}): boolean {
  const t = text.toLowerCase();
  if (t.includes("denadatequila")) return true;
  const named = t.includes("de nada") || /\bdenada\b/.test(t);
  if (!named) return false;
  if (SPIRITS_WORDS.test(t)) return true;
  return Boolean(opts.forumContext) && !isCourtesy(text);
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
  const res = await fetch(
    `${base}/rss/search?q=${encodeURIComponent(`"de nada tequila"`)}&hl=en-US&gl=US&ceid=US:en`,
    { headers: UA, signal: TIMEOUT(12_000) }
  );
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

// ---------- Reddit ----------

/**
 * An OAuth token when credentials are configured, else null (anonymous).
 * Cached in-process for the life of the token.
 */
let tokenCache: { token: string; expires: number } | null = null;
async function redditToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (tokenCache && tokenCache.expires > Date.now() + 30_000) return tokenCache.token;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      ...UA,
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: TIMEOUT(12_000),
  });
  if (!res.ok) throw new Error(`reddit auth: HTTP ${res.status}`);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("reddit auth: no token returned");
  tokenCache = { token: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

type RedditPost = {
  permalink?: string;
  title?: string;
  selftext?: string;
  author?: string;
  subreddit?: string;
  created_utc?: number;
  num_comments?: number;
};
type RedditComment = {
  permalink?: string;
  body?: string;
  author?: string;
  subreddit?: string;
  created_utc?: number;
  link_title?: string;
};

/** One authenticated-or-anonymous Reddit GET, paced to respect rate limits. */
async function redditGet(path: string, token: string | null): Promise<unknown> {
  const override = process.env.MENTIONS_REDDIT_URL;
  const base = override || (token ? "https://oauth.reddit.com" : "https://www.reddit.com");
  const res = await fetch(`${base}${path}`, {
    headers: token && !override ? { ...UA, Authorization: `Bearer ${token}` } : UA,
    signal: TIMEOUT(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const postsFrom = (j: unknown): RedditPost[] =>
  ((j as { data?: { children?: Array<{ data?: RedditPost }> } })?.data?.children ?? [])
    .map((c) => c.data)
    .filter((d): d is RedditPost => Boolean(d));

const foundFromPost = (d: RedditPost): Found => ({
  url: `https://www.reddit.com${d.permalink}`,
  source: "REDDIT",
  title: d.title ?? "",
  snippet: (d.selftext ?? "").slice(0, 300),
  author: d.subreddit ? `r/${d.subreddit} · u/${d.author ?? "?"}` : `u/${d.author ?? "?"}`,
  publishedAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
});

/** Walk a thread's comment tree (Reddit nests replies arbitrarily deep). */
function walkComments(node: unknown, out: RedditComment[], depth = 0): void {
  if (!node || depth > 8) return;
  const listing = node as { data?: { children?: Array<{ kind?: string; data?: RedditComment & { replies?: unknown } }> } };
  for (const c of listing.data?.children ?? []) {
    if (c.kind !== "t1" || !c.data) continue;
    out.push(c.data);
    if (c.data.replies) walkComments(c.data.replies, out, depth + 1);
  }
}

async function fetchReddit(): Promise<Found[]> {
  const token = await redditToken().catch(() => null);
  const out: Found[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  const add = (f: Found) => {
    if (!f.url || seen.has(f.url)) return;
    seen.add(f.url);
    out.push(f);
  };
  // bounded so a daily scan never hammers Reddit
  let budget = 24;
  const call = async (path: string): Promise<unknown | null> => {
    if (budget-- <= 0) return null;
    try {
      return await redditGet(path, token);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  // 1. site-wide searches for the brand
  for (const q of QUERIES) {
    const j = await call(`/search.json?q=${encodeURIComponent(q)}&sort=new&limit=25&t=year`);
    for (const d of postsFrom(j)) {
      if (!d.permalink || !d.title) continue;
      if (!isAboutUs(`${d.title} ${d.selftext ?? ""}`)) continue;
      add(foundFromPost(d));
    }
  }

  // 2. searches inside the spirits forums, where "De Nada" alone is enough
  for (const sub of SUBREDDITS) {
    const j = await call(
      `/r/${sub}/search.json?q=${encodeURIComponent(`"de nada"`)}&restrict_sr=1&sort=new&limit=25&t=year`
    );
    for (const d of postsFrom(j)) {
      if (!d.permalink || !d.title) continue;
      if (!isAboutUs(`${d.title} ${d.selftext ?? ""}`, { forumContext: true })) continue;
      add(foundFromPost(d));
    }
  }

  // 3. the comment threads under everything we matched — this is where the
  //    real "I tried De Nada last week" conversation actually lives
  const threads = [...out].filter((f) => f.url.includes("/comments/")).slice(0, 10);
  for (const t of threads) {
    const path = t.url.replace("https://www.reddit.com", "").replace(/\/$/, "");
    const j = await call(`${path}.json?limit=200&depth=6`);
    if (!Array.isArray(j) || j.length < 2) continue;
    const comments: RedditComment[] = [];
    walkComments(j[1], comments);
    for (const c of comments) {
      if (!c.permalink || !c.body) continue;
      if (!isAboutUs(c.body, { forumContext: true })) continue;
      add({
        url: `https://www.reddit.com${c.permalink}`,
        source: "REDDIT",
        title: c.body.slice(0, 120),
        snippet: c.body.slice(0, 300),
        author: `r/${c.subreddit ?? "?"} · u/${c.author ?? "?"} · comment`,
        publishedAt: c.created_utc ? new Date(c.created_utc * 1000) : null,
      });
    }
  }

  // every request failed — surface that instead of reporting a quiet internet
  if (out.length === 0 && errors.length > 0) {
    throw new Error(`reddit: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`);
  }
  return out;
}

async function fetchBluesky(): Promise<Found[]> {
  const base = process.env.MENTIONS_BSKY_URL || "https://public.api.bsky.app";
  const res = await fetch(
    `${base}/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(`"de nada tequila"`)}&limit=25`,
    { headers: UA, signal: TIMEOUT(12_000) }
  );
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

export type SourceStat = { source: "NEWS" | "REDDIT" | "BLUESKY"; found: number; error?: string };
export type ScanResult = {
  at: string;
  found: number;
  new: number;
  errors: string[];
  sources?: SourceStat[];
};

export async function runMentionScan(): Promise<ScanResult> {
  const jobs: { source: SourceStat["source"]; run: () => Promise<Found[]> }[] = [
    { source: "NEWS", run: fetchGoogleNews },
    { source: "REDDIT", run: fetchReddit },
    { source: "BLUESKY", run: fetchBluesky },
  ];
  const settled = await Promise.allSettled(jobs.map((j) => j.run()));

  const sources: SourceStat[] = settled.map((s, i) => ({
    source: jobs[i].source,
    found: s.status === "fulfilled" ? s.value.length : 0,
    error: s.status === "rejected" ? String(s.reason?.message ?? s.reason) : undefined,
  }));
  const errors = sources.filter((s) => s.error).map((s) => `${s.source.toLowerCase()}: ${s.error}`);
  const found = settled
    .filter((s): s is PromiseFulfilledResult<Found[]> => s.status === "fulfilled")
    .flatMap((s) => s.value);

  let fresh = 0;
  for (const f of found) {
    const existing = await db.mention.findUnique({ where: { url: f.url } });
    if (existing) continue;
    await db.mention.create({
      data: { url: f.url, source: f.source, title: f.title, snippet: f.snippet, author: f.author, publishedAt: f.publishedAt },
    });
    fresh++;
  }
  const result: ScanResult = { at: new Date().toISOString(), found: found.length, new: fresh, errors, sources };
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
