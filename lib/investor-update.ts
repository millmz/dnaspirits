import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { agentEnabled } from "./agent";
import { getMonthlyKpis, getAnnualFinancials } from "./kpi";
import { getNewsBrief } from "./news";
import { getSetting, setSetting } from "./settings";

/**
 * The investor update builder: aggregates everything the platform already
 * knows into the shape of Adam's real shareholder letters (Growth, Industry,
 * Marketing, PR…), so writing one is filling in narrative — not hunting
 * numbers.
 */

export const UPDATE_SECTIONS = [
  { key: "growth", title: "Growth", hint: "Momentum, new launches, projections — the numbers are pulled in for you." },
  { key: "feedback", title: "Feedback", hint: "What the market is telling you — packaging, formats, the liquid." },
  { key: "evolution", title: "Resilience & Strategic Evolution", hint: "What you're changing and why." },
  { key: "industry", title: "Industry Update", hint: "Color beyond the aggregated headlines — distribution moves, category shifts." },
  { key: "marketing", title: "Marketing", hint: "Campaigns, activations, where the budget is pointed." },
  { key: "pr", title: "PR", hint: "Placements, awards, organic moments." },
  { key: "milestones", title: "Upcoming Milestones", hint: "Events, launches, dates to share." },
  { key: "closing", title: "Closing", hint: "The note you want to end on." },
] as const;

export type InvestorData = {
  asOf: string;
  revenue: {
    byYear: { year: string; revenueCents: number; growthPct: number | null; isOpsYtd: boolean }[];
    inceptionCents: number;
  };
  volumeYtd: { tier: string; cases: number }[];
  volumeBySku: { name: string; sizeMl: number; cases: number }[];
  distribution: { importer: string | null; distributors: number; markets: string[] };
  community: {
    platforms: { platform: string; followers: number; changePct: number | null }[];
    topPosts: { title: string; channel: string; views: number }[];
  };
  press: { source: string; title: string; url: string; at: string }[];
  industry: { summary: string; headlines: { title: string; source: string }[] } | null;
};

export async function aggregateInvestorData(): Promise<InvestorData> {
  const now = new Date();
  const year = now.getFullYear();
  const yearStart = new Date(`${year}-01-01T00:00:00Z`);

  const [annual, kpis, lines, distributors, importer, metrics, topPosts, mentions, news] = await Promise.all([
    getAnnualFinancials(),
    getMonthlyKpis(),
    db.exWorksLine.findMany({
      where: { sale: { status: "CONFIRMED", date: { gte: yearStart } } },
      include: { product: true },
    }),
    db.distributor.findMany({ where: { market: { not: "" } } }),
    db.importer.findFirst(),
    db.accountMetric.findMany({ orderBy: { fetchedAt: "desc" }, take: 40 }),
    db.socialPost.findMany({
      where: { status: "POSTED", date: { gte: yearStart } },
      include: { metrics: { orderBy: { fetchedAt: "desc" }, take: 1 } },
    }),
    db.mention.findMany({ orderBy: [{ foundAt: "desc" }], take: 6 }),
    getNewsBrief().catch(() => null),
  ]);

  // --- revenue by year: booked financials first, live ops for the year the books haven't caught up to
  const years = [...annual.keys()].sort();
  const byYear: InvestorData["revenue"]["byYear"] = [];
  for (const y of years) {
    const rev = annual.get(y)!.income;
    const prev = byYear[byYear.length - 1];
    byYear.push({
      year: y,
      revenueCents: rev,
      growthPct: prev && prev.revenueCents > 0 ? Math.round(((rev - prev.revenueCents) / prev.revenueCents) * 100) : null,
      isOpsYtd: false,
    });
  }
  if (!annual.has(String(year))) {
    const ytd = kpis
      .filter((k) => k.period.startsWith(`${year}-`))
      .reduce((a, k) => a + k.shipmentRevenueCents - k.chargebackCents, 0);
    if (ytd > 0) {
      const prev = byYear[byYear.length - 1];
      byYear.push({
        year: `${year} YTD`,
        revenueCents: ytd,
        growthPct: prev && prev.revenueCents > 0 ? Math.round(((ytd - prev.revenueCents) / prev.revenueCents) * 100) : null,
        isOpsYtd: true,
      });
    }
  }
  const inceptionCents = byYear.reduce((a, y) => a + y.revenueCents, 0);

  // --- volume this year by expression and by SKU (confirmed ex-works sales)
  const tierCases = new Map<string, number>();
  const skuCases = new Map<string, { name: string; sizeMl: number; cases: number }>();
  for (const l of lines) {
    tierCases.set(l.product.tier, (tierCases.get(l.product.tier) ?? 0) + l.cases);
    const cur = skuCases.get(l.product.sku) ?? { name: l.product.name, sizeMl: l.product.sizeMl, cases: 0 };
    cur.cases += l.cases;
    skuCases.set(l.product.sku, cur);
  }

  // --- community: latest follower count per platform + change vs ~90 days back
  const platforms: InvestorData["community"]["platforms"] = [];
  for (const platform of [...new Set(metrics.map((m) => m.platform))]) {
    const rows = metrics.filter((m) => m.platform === platform);
    const latest = rows[0];
    const old = rows.filter((m) => m.fetchedAt < new Date(Date.now() - 80 * 86400_000)).at(0) ?? rows.at(-1);
    platforms.push({
      platform,
      followers: latest.followers,
      changePct:
        old && old.followers > 0 && old.id !== latest.id
          ? Math.round(((latest.followers - old.followers) / old.followers) * 100)
          : null,
    });
  }

  return {
    asOf: now.toISOString(),
    revenue: { byYear, inceptionCents },
    volumeYtd: [...tierCases.entries()].map(([tier, cases]) => ({ tier, cases })).sort((a, b) => b.cases - a.cases),
    volumeBySku: [...skuCases.values()].sort((a, b) => b.cases - a.cases),
    distribution: {
      importer: importer?.name ?? null,
      distributors: distributors.length,
      markets: [...new Set(distributors.map((d) => d.market))].sort(),
    },
    community: {
      platforms,
      topPosts: topPosts
        .map((p) => ({ title: p.title, channel: p.channel, views: p.metrics[0]?.views ?? 0 }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 3),
    },
    press: mentions.map((m) => ({
      source: m.source,
      title: m.title,
      url: m.url,
      at: (m.publishedAt ?? m.foundAt).toISOString().slice(0, 10),
    })),
    industry: news
      ? {
          summary: news.summary,
          headlines: news.items.filter((i) => i.relevance >= 3).slice(0, 4).map((i) => ({ title: i.title, source: i.source })),
        }
      : null,
  };
}

const VOICE_GUIDE =
  "Write as Adam Millman, CEO of De Nada Tequila, addressing shareholders. His letters open with the " +
  "date context and 'Dear Shareholders,' then flow through sections titled exactly: Growth / Feedback / " +
  "Resilience and Strategic Evolution / Industry Update / Marketing / PR / Upcoming Milestones / Closing. " +
  "The voice: direct, warm, confident without hype; short declarative sentences ('Momentum is measurable. " +
  "Revenue is growing.'); honest about challenges before pivoting to the response; grounded in specific " +
  "numbers; long-term framing ('discipline, conviction, and long-term focus'); recurring themes are the " +
  "additive-free integrity of the liquid ('just agave, water, and yeast'), hospitality as a brand pillar, " +
  "and patience in building distribution. Sign off 'Adam Millman, Chief Executive Officer'. Plain text " +
  "only, no markdown syntax — section titles on their own line.";

/** Draft the full letter from the aggregated numbers + the founders' section notes. */
export async function generateInvestorDraft(): Promise<{ ok: boolean; error?: string }> {
  if (!agentEnabled()) return { ok: false, error: "AI is not configured." };
  const data = await aggregateInvestorData();
  const notes: Record<string, string> = {};
  for (const s of UPDATE_SECTIONS) notes[s.title] = (await getSetting(`invupd-note-${s.key}`)) || "(no notes)";
  try {
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: VOICE_GUIDE,
      messages: [
        {
          role: "user",
          content:
            `Today is ${new Date().toDateString()}. Draft the next shareholder update.\n\n` +
            `Live aggregated data (use these numbers — never invent figures; money values ending in Cents are US cents):\n${JSON.stringify(data)}\n\n` +
            `The founders' notes per section (expand these into the narrative; where a section has no notes, write only what the data supports or keep it brief):\n${JSON.stringify(notes)}`,
        },
      ],
    });
    const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
    if (!text) return { ok: false, error: "Empty draft came back." };
    await setSetting("invupd-draft", text);
    return { ok: true };
  } catch (e) {
    console.error("investor draft failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Draft failed." };
  }
}
