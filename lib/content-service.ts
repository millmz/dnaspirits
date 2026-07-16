import { db } from "./db";
import { toDate } from "./format";

/**
 * Shared content-calendar operations used by BOTH external surfaces:
 *  - the REST content API (/api/content) for Custom GPT Actions
 *  - the MCP endpoint (/api/mcp/[key]) for ChatGPT Agents / MCP clients
 * One write path: agent proposals are ALWAYS created as unapproved drafts
 * (source=AGENT, approved=false) and only a human can move them to the
 * live calendar from the Content page.
 */

export const CONTENT_CHANNELS = ["INSTAGRAM", "TIKTOK", "YOUTUBE", "EMAIL", "OTHER"];
export const CONTENT_STATUSES = ["IDEA", "DRAFTED", "SCHEDULED", "POSTED"];

export type ShapedPost = {
  id: string;
  date: string;
  channel: string;
  title: string;
  caption: string;
  hashtags: string;
  assetUrl: string;
  status: string;
  source: string;
  approved: boolean;
};

export function shapePost(p: {
  id: string;
  date: Date;
  channel: string;
  title: string;
  caption: string;
  hashtags: string;
  assetUrl: string;
  status: string;
  source: string;
  approved: boolean;
}): ShapedPost {
  return {
    id: p.id,
    date: p.date.toISOString().slice(0, 10),
    channel: p.channel,
    title: p.title,
    caption: p.caption,
    hashtags: p.hashtags,
    assetUrl: p.assetUrl,
    status: p.status,
    source: p.source,
    approved: p.approved,
  };
}

export async function listContentPosts(filters: {
  from?: string | null;
  to?: string | null;
  status?: string | null;
}): Promise<ShapedPost[]> {
  const where: Record<string, unknown> = {};
  const dateFilter: Record<string, Date> = {};
  if (filters.from) dateFilter.gte = toDate(filters.from);
  if (filters.to) dateFilter.lte = toDate(filters.to);
  if (filters.from || filters.to) where.date = dateFilter;
  if (filters.status) where.status = String(filters.status).toUpperCase();

  const posts = await db.socialPost.findMany({
    where,
    orderBy: { date: "asc" },
    take: 200,
  });
  return posts.map(shapePost);
}

export type ProposeInput = {
  title?: unknown;
  date?: unknown;
  channel?: unknown;
  caption?: unknown;
  hashtags?: unknown;
  assetUrl?: unknown;
  notes?: unknown;
};

export async function proposeContentPost(
  input: ProposeInput
): Promise<{ ok: true; post: ShapedPost } | { ok: false; error: string }> {
  const title = String(input.title ?? "").trim();
  if (!title) return { ok: false, error: "title is required." };
  const channelRaw = String(input.channel ?? "INSTAGRAM").toUpperCase();
  const channel = CONTENT_CHANNELS.includes(channelRaw) ? channelRaw : "INSTAGRAM";

  const created = await db.socialPost.create({
    data: {
      date: toDate(String(input.date ?? "")),
      channel,
      title,
      caption: String(input.caption ?? "").trim(),
      hashtags: String(input.hashtags ?? "").trim(),
      assetUrl: String(input.assetUrl ?? "").trim(),
      notes: String(input.notes ?? "").trim(),
      status: "DRAFTED",
      source: "AGENT",
      approved: false, // pending human approval in the app
    },
  });
  return { ok: true, post: shapePost(created) };
}
