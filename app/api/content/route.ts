import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authContentApi } from "@/lib/content-api";
import { toDate } from "@/lib/format";

const CHANNELS = ["INSTAGRAM", "TIKTOK", "YOUTUBE", "EMAIL", "OTHER"];

const shape = (p: {
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
}) => ({
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
});

/**
 * GET /api/content — list posts. Optional query: from, to (YYYY-MM-DD), status.
 * Read access for the brand-manager agent to see what's planned and posted.
 */
export async function GET(req: NextRequest) {
  const auth = authContentApi(req);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const url = req.nextUrl;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const status = url.searchParams.get("status");
  const where: Record<string, unknown> = {};
  const dateFilter: Record<string, Date> = {};
  if (from) dateFilter.gte = toDate(from);
  if (to) dateFilter.lte = toDate(to);
  if (from || to) where.date = dateFilter;
  if (status) where.status = status.toUpperCase();

  const posts = await db.socialPost.findMany({
    where,
    orderBy: { date: "asc" },
    take: 200,
  });
  return NextResponse.json({ posts: posts.map(shape) });
}

/**
 * POST /api/content — the agent proposes a post. It's created as a DRAFT
 * pending human approval (source=AGENT, approved=false) — it will not appear
 * on the live calendar until approved in the app. Content only; the agent
 * cannot change status to POSTED or touch anything outside social posts.
 */
export async function POST(req: NextRequest) {
  const auth = authContentApi(req);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "title is required." }, { status: 400 });
  const channelRaw = String(body.channel ?? "INSTAGRAM").toUpperCase();
  const channel = CHANNELS.includes(channelRaw) ? channelRaw : "INSTAGRAM";

  const created = await db.socialPost.create({
    data: {
      date: toDate(String(body.date ?? "")),
      channel,
      title,
      caption: String(body.caption ?? "").trim(),
      hashtags: String(body.hashtags ?? "").trim(),
      assetUrl: String(body.assetUrl ?? "").trim(),
      notes: String(body.notes ?? "").trim(),
      status: "DRAFTED",
      source: "AGENT",
      approved: false, // pending human approval
    },
  });

  return NextResponse.json(
    { ...shape(created), message: "Draft created — pending approval in the De Nada app." },
    { status: 201 }
  );
}
