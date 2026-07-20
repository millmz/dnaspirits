import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { agentEnabled } from "./agent";
import { readIdentity, readKnowledge } from "./nada";
import { listMemories, recallMemories, saveMemory, deleteMemory, MEMORY_TYPES } from "./nada-memory";
import { getMonthlyKpis, getAnnualFinancials } from "./kpi";
import { getOpenReceivables } from "./receivables";
import { getStock, getComponentStock } from "./inventory";
import { getMarketPosition } from "./market";
import { getNewsBrief, runNewsRefresh } from "./news";
import { getRecentMentions, runMentionScan } from "./mentions";
import { computeAlerts } from "./alerts";

/**
 * Nada's brain. Every turn assembles a TWO-BLOCK system prompt:
 *   1. STABLE (cacheable): full identity + operating rules + core knowledge
 *      + memory discipline + a derived capability list. Changes only when a
 *      file changes, so the provider serves it from cache — which is what
 *      lets the entire personality ride along on every single turn.
 *   2. DYNAMIC (never cached): current time, the live data snapshot,
 *      relevant recalled memories, and — deep into a conversation — a
 *      personality checkpoint against drift.
 * Conversation is persisted per-session (NadaSession/NadaTurn) with a
 * bounded context window, so the thread survives reloads and restarts.
 */

const WINDOW_TURNS = 20; // context window per request; full history stays in the DB
const DRIFT_CHECKPOINT_AT = 14; // turns before the self-audit rides along

async function buildContext(): Promise<string> {
  const [kpis, ar, stock, componentStock, components, position, openPos, products, recentPosts, followers, news, alerts, upcoming, legalDue, annual, bm] =
    await Promise.all([
      getMonthlyKpis(),
      getOpenReceivables(),
      getStock(),
      getComponentStock(),
      db.component.findMany({ where: { active: true }, include: { supplier: true } }),
      db.purchaseOrder.findMany({
        where: { status: "ORDERED" },
        include: { supplier: true, lines: { include: { component: true } } },
      }),
      getMarketPosition(),
      db.product.findMany({ where: { active: true } }),
      db.socialPost.findMany({
        where: { status: "POSTED" },
        orderBy: { date: "desc" },
        take: 15,
        include: { metrics: { orderBy: { fetchedAt: "desc" }, take: 2 } },
      }),
      db.accountMetric.findMany({ orderBy: { fetchedAt: "desc" }, take: 4 }),
      getNewsBrief().catch(() => null),
      computeAlerts().catch(() => []),
      db.socialPost.findMany({
        where: { status: { in: ["IDEA", "DRAFTED", "SCHEDULED"] } },
        orderBy: { date: "asc" },
        take: 15,
      }),
      db.legalRecord.findMany({
        where: { status: "ACTIVE", dueDate: { not: null, lte: new Date(Date.now() + 120 * 86400_000) } },
        orderBy: { dueDate: "asc" },
      }),
      getAnnualFinancials().catch(() => []),
      getRecentMentions(8).catch(() => []),
    ]).then(([k, a, s, cs, c, po, mp, pr, rp, f, n, al, up, ld, an, bm]) => [k, a, s, cs, c, mp, po, pr, rp, f, n, al, up, ld, an, bm] as const);

  const ctx = {
    monthlyKpis_last18: kpis.slice(-18),
    receivables: {
      totalNetCents: ar.totalNetCents,
      aging: ar.aging,
      openInvoices: ar.items.map((i) => ({
        importer: i.importerName, invoice: i.invoiceNumber, netDueCents: i.netDueCents,
        dueDate: i.dueDate?.toISOString().slice(0, 10) ?? null, overdue: i.overdue,
      })),
    },
    finishedGoodsStock: stock,
    dryGoods: components.map((c) => ({
      name: c.name, category: c.category, unit: c.unit, supplier: c.supplier?.name ?? null,
      onHand: Math.round((componentStock.get(c.id) ?? 0) * 100) / 100,
      reorderPoint: c.reorderPoint, leadTimeDays: c.leadTimeDays, unitCostCents: c.unitCostCents,
    })),
    openPurchaseOrders: openPos.map((po) => ({
      poNumber: po.poNumber, supplier: po.supplier.name,
      expected: po.expectedDate?.toISOString().slice(0, 10) ?? null,
      lines: po.lines.map((l) => ({ component: l.component.name, qty: l.qty, unitCostCents: l.unitCostCents })),
    })),
    marketPosition: position,
    products: products.map((p) => ({
      sku: p.sku, name: p.name, sizeMl: p.sizeMl, bottlesPerCase: p.bottlesPerCase,
      caseCostCents: p.caseCostCents, exWorksCents: p.exWorksCents,
    })),
    recentPublishedPosts: recentPosts.map((p) => ({
      date: p.date.toISOString().slice(0, 10), title: p.title, channel: p.channel,
      latest: p.metrics[0] ? { views: p.metrics[0].views, reach: p.metrics[0].reach, likes: p.metrics[0].likes } : null,
    })),
    socialAccounts: followers.map((f) => ({ platform: f.platform, followers: f.followers, at: f.fetchedAt.toISOString().slice(0, 10) })),
    industryNewsBrief: news
      ? {
          asOf: news.at,
          summary: news.summary,
          topHeadlines: news.items.slice(0, 8).map((i) => ({ title: i.title, source: i.source, relevance: i.relevance })),
        }
      : "no brief yet — the refresh_industry_news tool builds one",
    needsAttention: alerts.map((a) => ({ severity: a.severity, area: a.area, message: a.message })),
    upcomingAndDraftPosts: upcoming.map((p) => ({
      id: p.id, date: p.date.toISOString().slice(0, 16), title: p.title, channel: p.channel,
      status: p.status, format: p.format, autoPublish: p.autoPublish, backlogIdea: p.unscheduled,
    })),
    legalDeadlinesNext120Days: legalDue.map((l) => ({
      title: l.title, type: l.type, due: l.dueDate?.toISOString().slice(0, 10) ?? null, reference: l.reference,
    })),
    annualFinancials: annual,
    brandMentions_recent: bm.map((m) => ({
      source: m.source, title: m.title.slice(0, 140), author: m.author,
      at: (m.publishedAt ?? m.foundAt).toISOString().slice(0, 10), url: m.url,
    })),
  };
  return JSON.stringify(ctx);
}

const SNAPSHOT_SECTIONS = [
  "monthly KPIs", "receivables & aging", "finished goods stock", "dry goods & reorder points",
  "open purchase orders", "market position", "product catalog", "recent posts & metrics", "social followers",
  "the industry news brief", "current alerts", "upcoming & draft posts", "legal deadlines", "annual financials",
  "recent brand mentions from around the internet",
];

// ---------- tools (tier 7) ----------

const TOOLS: Anthropic.Tool[] = [
  {
    name: "save_memory",
    description:
      "Save a durable long-term memory. Use for things the founders teach you, corrections they make, " +
      "decisions on projects, and stable preferences. NEVER for transient task state, the current " +
      "conversation itself, anything derivable from the data snapshot, or secrets/credentials/private data.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: [...MEMORY_TYPES], description: "FACT about them/the business; PREFERENCE for how they want you to work; PROJECT for active work; POINTER to an external resource" },
        hook: { type: "string", description: "One searchable line summarizing the memory" },
        body: { type: "string", description: "The fact plus why it matters and how to apply it" },
      },
      required: ["type", "hook", "body"],
    },
  },
  {
    name: "recall_memory",
    description: "Search long-term memory beyond what was auto-recalled for this turn.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "forget_memory",
    description:
      "Delete a memory by id. Requires confirmed=true, which you may only set AFTER the user has " +
      "explicitly confirmed in this conversation that they want it forgotten. Without confirmation, " +
      "call with confirmed=false to look up what would be deleted and ask the user first.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["id", "confirmed"],
    },
  },
  {
    name: "get_data",
    description:
      "Fetch a detailed platform dataset that is not in the snapshot. Use when the snapshot's summary " +
      "isn't enough to answer precisely.",
    input_schema: {
      type: "object" as const,
      properties: {
        section: {
          type: "string",
          enum: ["influencers_and_press", "cap_table", "legal_register", "content_calendar", "industry_news_full", "brand_mentions"],
        },
      },
      required: ["section"],
    },
  },
  {
    name: "refresh_industry_news",
    description:
      "Rebuild the tequila/spirits industry brief from the news feeds right now. Use when the user asks " +
      "for an industry update and the snapshot's brief is missing or stale. Takes ~10 seconds.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "scan_brand_mentions",
    description:
      "Sweep the internet (news, Reddit, Bluesky) for fresh De Nada mentions right now. The platform " +
      "already does this daily — use only when the user asks what people are saying and the snapshot " +
      "looks stale or empty. Takes ~10 seconds.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "draft_post",
    description:
      "Create a draft post on the content calendar. Never publishes anything — it lands as a DRAFTED " +
      "entry for the founders to review. ACTION RULE: first call with confirmed=false to get a preview, " +
      "read it back to the user, and only call with confirmed=true after they clearly say yes.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Short internal title" },
        caption: { type: "string", description: "The caption text" },
        hashtags: { type: "string", description: "Space-separated hashtags, optional" },
        channel: { type: "string", enum: ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "EMAIL", "OTHER"] },
        format: { type: "string", enum: ["FEED", "STORY"] },
        date: { type: "string", description: "YYYY-MM-DD target date; omit to park it in the idea backlog" },
        first_comment: { type: "string", description: "Optional first comment (link, extra hashtags)" },
        confirmed: { type: "boolean" },
      },
      required: ["title", "caption", "confirmed"],
    },
  },
  {
    name: "schedule_post",
    description:
      "Schedule an existing calendar post (id from the snapshot or get_data) for a date and time. With " +
      "auto_publish=true the platform will actually publish it to Meta at that time — only set that when " +
      "the user explicitly asks for auto-publish. ACTION RULE: preview with confirmed=false, read it back, " +
      "then confirmed=true only after a clear yes.",
    input_schema: {
      type: "object" as const,
      properties: {
        post_id: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD or 'YYYY-MM-DD HH:MM' 24h local time" },
        auto_publish: { type: "boolean" },
        confirmed: { type: "boolean" },
      },
      required: ["post_id", "date", "confirmed"],
    },
  },
  {
    name: "add_influencer",
    description:
      "Add an influencer or press contact to the Influencers & PR pipeline as a PROSPECT. " +
      "ACTION RULE: preview with confirmed=false, read it back, then confirmed=true only after a clear yes.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        handle: { type: "string" },
        platform: { type: "string", description: "Instagram / TikTok / publication name" },
        type: { type: "string", enum: ["INFLUENCER", "PRESS"] },
        market: { type: "string", description: "e.g. NY, FL" },
        notes: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["name", "confirmed"],
    },
  },
];

async function getDataSection(section: string): Promise<string> {
  if (section === "influencers_and_press") {
    const rows = await db.partner.findMany({ orderBy: { updatedAt: "desc" } });
    return JSON.stringify(rows.map((p) => ({
      id: p.id, type: p.type, name: p.name, handle: p.handle, platform: p.platform,
      market: p.market, followers: p.followers, status: p.status, notes: p.notes,
    })));
  }
  if (section === "cap_table") {
    const rows = await db.capTableEntry.findMany();
    return JSON.stringify(rows);
  }
  if (section === "legal_register") {
    const rows = await db.legalRecord.findMany({ orderBy: { dueDate: "asc" } });
    return JSON.stringify(rows.map((l) => ({
      id: l.id, type: l.type, title: l.title, reference: l.reference, jurisdiction: l.jurisdiction,
      status: l.status, executed: l.executed?.toISOString().slice(0, 10) ?? null,
      due: l.dueDate?.toISOString().slice(0, 10) ?? null, notes: l.notes,
    })));
  }
  if (section === "content_calendar") {
    const rows = await db.socialPost.findMany({
      where: { date: { gte: new Date(Date.now() - 14 * 86400_000) } },
      orderBy: { date: "asc" },
      take: 60,
      include: { items: { select: { id: true } } },
    });
    return JSON.stringify(rows.map((p) => ({
      id: p.id, date: p.date.toISOString().slice(0, 16), title: p.title, channel: p.channel,
      status: p.status, format: p.format, autoPublish: p.autoPublish, backlogIdea: p.unscheduled,
      mediaCount: p.items.length, caption: p.caption.slice(0, 200),
    })));
  }
  if (section === "industry_news_full") {
    const brief = await getNewsBrief();
    return brief ? JSON.stringify(brief) : "No brief stored — call refresh_industry_news.";
  }
  if (section === "brand_mentions") {
    const rows = await getRecentMentions(40);
    if (rows.length === 0) return "No mentions found yet — call scan_brand_mentions to sweep right now.";
    return JSON.stringify(rows.map((m) => ({
      source: m.source, title: m.title, snippet: m.snippet, author: m.author, url: m.url,
      at: (m.publishedAt ?? m.foundAt).toISOString().slice(0, 10),
    })));
  }
  return "Unknown section.";
}

async function runTool(name: string, input: Record<string, unknown>, taughtBy: string): Promise<string> {
  try {
    if (name === "get_data") return await getDataSection(String(input.section ?? ""));
    if (name === "refresh_industry_news") {
      const brief = await runNewsRefresh();
      return `Brief rebuilt (${brief.items.length} stories). Summary: ${brief.summary}\nTop headlines: ${brief.items
        .slice(0, 6)
        .map((i) => `${i.title} (${i.source})`)
        .join(" | ")}`;
    }
    if (name === "scan_brand_mentions") {
      const r = await runMentionScan();
      return `Scan done: ${r.found} mention(s) seen across news/Reddit/Bluesky, ${r.new} new${r.errors.length ? ` (some sources unreachable: ${r.errors.join("; ")})` : ""}. Details via get_data(brand_mentions).`;
    }
    if (name === "draft_post") {
      const title = String(input.title ?? "").trim();
      const caption = String(input.caption ?? "").trim();
      if (!title || !caption) return "Need both a title and a caption.";
      const date = input.date ? new Date(String(input.date)) : null;
      if (date && isNaN(date.getTime())) return "Couldn't parse that date — use YYYY-MM-DD.";
      const summary =
        `draft post "${title}" on ${String(input.channel ?? "INSTAGRAM")} (${String(input.format ?? "FEED")})` +
        (date ? ` targeted for ${date.toISOString().slice(0, 10)}` : " parked in the idea backlog") +
        ` — caption: ${caption.slice(0, 120)}${caption.length > 120 ? "…" : ""}`;
      if (input.confirmed !== true) return `PREVIEW (not created yet): ${summary}. Read this back and get a clear yes, then call again with confirmed=true.`;
      const p = await db.socialPost.create({
        data: {
          title, caption,
          hashtags: String(input.hashtags ?? ""),
          firstComment: String(input.first_comment ?? ""),
          channel: String(input.channel ?? "INSTAGRAM"),
          format: String(input.format ?? "FEED"),
          date: date ?? new Date(),
          unscheduled: !date,
          status: "DRAFTED",
          source: "NADA",
          autoPublish: false,
        },
      });
      return `Created ${summary}. It's on the Content Calendar (id ${p.id}) — media still needs to be added there before it can publish.`;
    }
    if (name === "schedule_post") {
      const post = await db.socialPost.findUnique({ where: { id: String(input.post_id ?? "") }, include: { items: { select: { id: true } } } });
      if (!post) return "No post with that id — check get_data(content_calendar).";
      if (post.status === "POSTED") return `"${post.title}" is already published — nothing to schedule.`;
      const date = new Date(String(input.date ?? ""));
      if (isNaN(date.getTime())) return "Couldn't parse that date — use YYYY-MM-DD or 'YYYY-MM-DD HH:MM'.";
      const auto = input.auto_publish === true;
      if (auto && post.items.length === 0 && !post.assetUrl)
        return `"${post.title}" has no media attached yet, so auto-publish would fail. Schedule without auto-publish, or add media on the Content Calendar first.`;
      const summary = `schedule "${post.title}" for ${date.toLocaleString("en-US", { timeZone: process.env.TZ || "UTC" })}` +
        (auto ? " with AUTO-PUBLISH to Meta at that time" : " (no auto-publish — it stays a reminder)");
      if (input.confirmed !== true) return `PREVIEW (not scheduled yet): ${summary}. Read this back and get a clear yes, then call again with confirmed=true.`;
      await db.socialPost.update({
        where: { id: post.id },
        data: { date, status: "SCHEDULED", unscheduled: false, autoPublish: auto },
      });
      return `Done — ${summary}.`;
    }
    if (name === "add_influencer") {
      const nm = String(input.name ?? "").trim();
      if (!nm) return "Need a name.";
      const summary = `add ${String(input.type ?? "INFLUENCER").toLowerCase()} "${nm}"` +
        (input.handle ? ` (${String(input.handle)})` : "") +
        (input.platform ? ` on ${String(input.platform)}` : "") +
        ` to the pipeline as a prospect`;
      if (input.confirmed !== true) return `PREVIEW (not added yet): ${summary}. Read this back and get a clear yes, then call again with confirmed=true.`;
      const p = await db.partner.create({
        data: {
          name: nm,
          handle: String(input.handle ?? ""),
          platform: String(input.platform ?? ""),
          type: String(input.type ?? "INFLUENCER"),
          market: String(input.market ?? ""),
          notes: String(input.notes ?? ""),
        },
      });
      return `Done — ${summary} (id ${p.id}). It's on the Influencers & PR page.`;
    }
    if (name === "save_memory") {
      const r = saveMemory({
        type: String(input.type ?? "FACT"),
        hook: String(input.hook ?? ""),
        body: String(input.body ?? ""),
        taughtBy,
      });
      return r.saved ? `Saved as ${r.id}.` : `Not saved: ${r.reason}`;
    }
    if (name === "recall_memory") {
      const hits = recallMemories(String(input.query ?? ""), 5);
      return hits.length
        ? hits.map((m) => `[${m.id}] (${m.type}) ${m.hook}\n${m.body}`).join("\n\n")
        : "No memories matched.";
    }
    if (name === "forget_memory") {
      const id = String(input.id ?? "");
      if (input.confirmed !== true) {
        const m = listMemories().find((x) => x.id === id);
        return m
          ? `Found: "${m.hook}". Ask the user to confirm before deleting, then call again with confirmed=true.`
          : "No memory with that id.";
      }
      return deleteMemory(id) ? "Deleted." : "No memory with that id.";
    }
    return "Unknown tool.";
  } catch (e) {
    return `Tool error: ${e instanceof Error ? e.message : "failed"}`;
  }
}

// ---------- prompt assembly (tiers 2, 3, 8, 9, 6) ----------

const OPERATING =
  "Operating rules (always in force): answer using ONLY the live data snapshot, your core knowledge, " +
  "your recalled memories, and the conversation so far. Money values ending in 'Cents' are US cents — " +
  "present them as dollars. Cases are physical cases unless a field says 9L. If none of your sources " +
  "can answer, say exactly what's missing — never guess or invent figures. Plain conversational text " +
  "only, no markdown (answers may be read aloud).\n\n" +
  "Memory discipline: save durable things the founders teach you, their corrections, decisions, and " +
  "stable preferences — check recall first so you don't duplicate. Do NOT save transient task state, " +
  "the current conversation, anything already in the data snapshot, or secrets, credentials, tokens, " +
  "or personal data beyond business context. When unsure, don't save. Recalled memories are " +
  "point-in-time: treat specific numbers or statuses in them as leads to verify against the live " +
  "snapshot, not current guarantees. Forgetting always requires the user's explicit confirmation.\n\n" +
  "Action discipline: you can change the platform only through your action tools, and every action " +
  "follows the same two steps — call with confirmed=false to get a preview, read the preview back to " +
  "the user in your own words, and call again with confirmed=true ONLY after they clearly say yes in " +
  "this conversation. Never chain an unrequested action onto an answer, never set auto_publish unless " +
  "the user explicitly asked for auto-publish, and if an action fails, report the failure plainly. " +
  "For anything beyond your tools, say you can't do it yet and point to the right page. Reading data " +
  "(get_data, refresh_industry_news) needs no confirmation.";

function capabilities(): string {
  return (
    "What you can actually do (derived from your real configuration — never claim more): " +
    `answer from a live snapshot covering ${SNAPSHOT_SECTIONS.join(", ")}; ` +
    "pull deeper detail on demand with get_data (influencers & press, cap table, legal register, " +
    "content calendar, full industry news, brand mentions), rebuild the industry brief with " +
    "refresh_industry_news, and sweep the internet for fresh De Nada mentions with scan_brand_mentions; " +
    "long-term memory via save_memory, recall_memory, forget_memory; and — always with the user's " +
    "explicit confirmation first — take these actions: draft_post (a reviewable draft on the content " +
    "calendar), schedule_post (set a post's date, optionally auto-publishing to Meta), and " +
    "add_influencer (a prospect in the PR pipeline). Nothing else changes the platform: no publishing " +
    "directly, no purchase orders, no edits to financial records — for those, point to the right page. " +
    "Conversations persist across page reloads and restarts; the interface supports tap-to-talk input " +
    "and spoken replies where the user's browser allows it."
  );
}

function stableBlock(): string {
  return `${readIdentity()}\n\n${OPERATING}\n\n${capabilities()}\n\n# Core knowledge\n\n${readKnowledge()}`;
}

async function dynamicBlock(question: string, turnCount: number): Promise<string> {
  const recalled = recallMemories(question, 4);
  const memories = recalled.length
    ? "\n\nRelevant long-term memories (point-in-time — verify specifics against the snapshot):\n" +
      recalled.map((m) => `[${m.id}] (${m.type}, from ${m.taughtBy || "unknown"}, ${m.created.slice(0, 10)}) ${m.hook}\n${m.body}`).join("\n\n")
    : "";
  const checkpoint =
    turnCount >= DRIFT_CHECKPOINT_AT
      ? "\n\nPersonality checkpoint: this conversation is long enough that drift creeps in. Before " +
        "answering, check your draft against your identity: is it the right length (brief, speakable), " +
        "and is it in your voice — not generic-assistant openers, not hedging?"
      : "";
  return `Current time: ${new Date().toString()}\n\nLive data snapshot (fresh for this exchange):\n${await buildContext()}${memories}${checkpoint}`;
}

// ---------- sessions (tier 4) ----------

async function loadSession(sessionId: string | undefined, firstQuestion: string, userName: string) {
  if (sessionId) {
    const s = await db.nadaSession.findUnique({ where: { id: sessionId } });
    if (s) return s;
  }
  return db.nadaSession.create({
    data: { title: firstQuestion.slice(0, 80), userId: userName },
  });
}

export type AskTurn = { role: "user" | "assistant"; content: string };

export async function getLatestSession(): Promise<{ id: string; turns: AskTurn[] } | null> {
  const s = await db.nadaSession.findFirst({
    where: { lastAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    orderBy: { lastAt: "desc" },
    include: { turns: { orderBy: { createdAt: "asc" }, take: 60 } },
  });
  if (!s || s.turns.length === 0) return null;
  return { id: s.id, turns: s.turns.map((t) => ({ role: t.role as "user" | "assistant", content: t.content })) };
}

// ---------- the ask loop ----------

export async function askPlatform(
  question: string,
  opts: { sessionId?: string; userName?: string } = {}
): Promise<{ ok: true; answer: string; sessionId: string } | { ok: false; error: string }> {
  if (!agentEnabled()) return { ok: false, error: "AI is not configured (ANTHROPIC_API_KEY)." };
  try {
    const session = await loadSession(opts.sessionId, question, opts.userName ?? "");
    const priorTurns = await db.nadaTurn.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      take: WINDOW_TURNS,
    });
    const history: AskTurn[] = priorTurns
      .reverse()
      .map((t) => ({ role: t.role as "user" | "assistant", content: t.content }));

    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: stableBlock(), cache_control: { type: "ephemeral" } },
      { type: "text", text: await dynamicBlock(question, history.length) },
    ];

    const client = new Anthropic();
    const messages: Anthropic.MessageParam[] = [
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: "user" as const, content: question },
    ];

    let answer = "";
    for (let hop = 0; hop < 5; hop++) {
      const resp = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 1500,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system,
        tools: TOOLS,
        messages,
      });
      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      answer = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      if (toolUses.length === 0 || resp.stop_reason !== "tool_use") break;
      messages.push({ role: "assistant", content: resp.content });
      messages.push({
        role: "user",
        content: await Promise.all(
          toolUses.map(async (tu) => ({
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: await runTool(tu.name, tu.input as Record<string, unknown>, opts.userName ?? ""),
          }))
        ),
      });
    }
    if (!answer) return { ok: false, error: "No answer came back — try rephrasing." };

    await db.nadaTurn.createMany({
      data: [
        { sessionId: session.id, role: "user", content: question.slice(0, 4000) },
        { sessionId: session.id, role: "assistant", content: answer.slice(0, 8000) },
      ],
    });
    await db.nadaSession.update({ where: { id: session.id }, data: { lastAt: new Date(), extracted: false } });

    return { ok: true, answer, sessionId: session.id };
  } catch (e) {
    console.error("ask failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Ask failed." };
  }
}

// ---------- the session-end extractor (tier 7) ----------

const EXTRACT_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["memories"],
  properties: {
    memories: {
      type: "array" as const,
      maxItems: 5,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["type", "hook", "body"],
        properties: {
          type: { type: "string" as const, enum: [...MEMORY_TYPES] },
          hook: { type: "string" as const },
          body: { type: "string" as const },
        },
      },
    },
  },
};

/**
 * When a session has been quiet for a couple of hours, a cheap pass reads the
 * transcript and keeps only genuinely durable facts — deduped against what's
 * already stored, skipping sessions that are too short to matter.
 */
export async function runNadaExtractor(): Promise<{ sessions: number; saved: number }> {
  if (!agentEnabled()) return { sessions: 0, saved: 0 };
  const quiet = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const sessions = await db.nadaSession.findMany({
    where: { extracted: false, lastAt: { lt: quiet } },
    include: { turns: { orderBy: { createdAt: "asc" }, take: 80 } },
    take: 5,
  });
  let saved = 0;
  for (const s of sessions) {
    await db.nadaSession.update({ where: { id: s.id }, data: { extracted: true } });
    if (s.turns.length < 4) continue; // idle chatter / testing — nothing durable
    try {
      const existingHooks = listMemories().map((m) => `- ${m.hook}`).join("\n") || "(none)";
      const transcript = s.turns.map((t) => `${t.role}: ${t.content}`).join("\n").slice(0, 30000);
      const client = new Anthropic();
      const resp = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 1500,
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
        system:
          "You extract durable long-term memories from a founder/assistant conversation transcript. " +
          "Keep ONLY facts worth knowing months from now: things the founders taught, corrections, " +
          "decisions, stable preferences. Skip transient task state, numbers available from live data, " +
          "small talk, and anything that looks like testing. NEVER extract secrets, credentials, or " +
          "personal data beyond business context. Do not duplicate these existing memories:\n" +
          existingHooks,
        messages: [{ role: "user", content: `Transcript:\n${transcript}` }],
      });
      const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      const parsed = JSON.parse(text) as { memories: Array<{ type: string; hook: string; body: string }> };
      for (const m of parsed.memories ?? []) {
        const r = saveMemory({ ...m, taughtBy: "extractor" });
        if (r.saved) saved++;
      }
    } catch (e) {
      console.error(`nada extractor failed for session ${s.id}:`, e);
    }
  }
  return { sessions: sessions.length, saved };
}
