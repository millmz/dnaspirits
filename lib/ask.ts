import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { agentEnabled } from "./agent";
import { readIdentity, readKnowledge } from "./nada";
import { listMemories, recallMemories, saveMemory, deleteMemory, MEMORY_TYPES } from "./nada-memory";
import { getMonthlyKpis } from "./kpi";
import { getOpenReceivables } from "./receivables";
import { getStock, getComponentStock } from "./inventory";
import { getMarketPosition } from "./market";

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
  const [kpis, ar, stock, componentStock, components, position, openPos, products, recentPosts, followers] =
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
    ]).then(([k, a, s, cs, c, po, mp, pr, rp, f]) => [k, a, s, cs, c, mp, po, pr, rp, f] as const);

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
  };
  return JSON.stringify(ctx);
}

const SNAPSHOT_SECTIONS = [
  "monthly KPIs", "receivables & aging", "finished goods stock", "dry goods & reorder points",
  "open purchase orders", "market position", "product catalog", "recent posts & metrics", "social followers",
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
];

function runTool(name: string, input: Record<string, unknown>, taughtBy: string): string {
  try {
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
  "snapshot, not current guarantees. Forgetting always requires the user's explicit confirmation.";

function capabilities(): string {
  return (
    "What you can actually do (derived from your real configuration — never claim more): " +
    `answer from a live snapshot covering ${SNAPSHOT_SECTIONS.join(", ")}; ` +
    `long-term memory via tools: ${TOOLS.map((t) => t.name).join(", ")}; ` +
    "conversations persist across page reloads and restarts; the interface supports tap-to-talk " +
    "input and spoken replies where the user's browser allows it. You cannot take actions on the " +
    "platform (no posting, ordering, or editing records) — when asked to act, point to where in " +
    "the platform to do it."
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
        content: toolUses.map((tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: runTool(tu.name, tu.input as Record<string, unknown>, opts.userName ?? ""),
        })),
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
