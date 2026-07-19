import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { agentEnabled } from "./agent";
import { readIdentity } from "./nada";
import { getMonthlyKpis } from "./kpi";
import { getOpenReceivables } from "./receivables";
import { getStock, getComponentStock } from "./inventory";
import { getMarketPosition } from "./market";

/**
 * "Ask the platform": answers founder questions from a compact snapshot of
 * live data. The snapshot approach keeps it safe (read-only by construction)
 * and fast; it covers KPIs, inventory, AR, purchasing, market and content.
 */
async function buildContext(): Promise<string> {
  const [kpis, ar, stock, componentStock, components, position, openPos, products, recentPosts, followers] =
    await Promise.all([
      getMonthlyKpis(),
      getOpenReceivables(),
      getStock(),
      getComponentStock(),
      db.component.findMany({ where: { active: true }, include: { supplier: true } }),
      getMarketPosition(),
      db.purchaseOrder.findMany({
        where: { status: "ORDERED" },
        include: { supplier: true, lines: { include: { component: true } } },
      }),
      db.product.findMany({ where: { active: true } }),
      db.socialPost.findMany({
        where: { status: "POSTED" },
        orderBy: { date: "desc" },
        take: 15,
        include: { metrics: { orderBy: { fetchedAt: "desc" }, take: 2 } },
      }),
      db.accountMetric.findMany({ orderBy: { fetchedAt: "desc" }, take: 4 }),
    ]);

  const ctx = {
    today: new Date().toISOString().slice(0, 10),
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
      totalCents: po.lines.reduce((a, l) => a + Math.round(l.qty * l.unitCostCents), 0),
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

// Mechanics that must hold regardless of how the personality file is edited.
const OPERATING =
  "Operating rules (always in force): answer using ONLY the JSON data snapshot provided and the " +
  "conversation so far. Money values ending in 'Cents' are US cents — present them as dollars. " +
  "Cases are physical cases unless a field says 9L. If the snapshot genuinely can't answer, say " +
  "exactly what data is missing — never guess or invent figures. Plain conversational text only, " +
  "no markdown (answers may be read aloud).";

export type AskTurn = { role: "user" | "assistant"; content: string };

export async function askPlatform(
  question: string,
  history: AskTurn[] = []
): Promise<{ ok: true; answer: string } | { ok: false; error: string }> {
  if (!agentEnabled()) return { ok: false, error: "AI is not configured (ANTHROPIC_API_KEY)." };
  try {
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1200,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // identity is a living file — an edit shapes the very next reply
      system: `${readIdentity()}\n\n${OPERATING}\n\nLive data snapshot (fresh for this exchange):\n${await buildContext()}`,
      messages: [
        ...history.slice(-12).map((t) => ({ role: t.role, content: t.content })),
        { role: "user" as const, content: question },
      ],
    });
    const answer = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return answer ? { ok: true, answer } : { ok: false, error: "No answer came back — try rephrasing." };
  } catch (e) {
    console.error("ask failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Ask failed." };
  }
}
