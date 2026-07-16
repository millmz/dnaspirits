import { NextRequest, NextResponse } from "next/server";
import { authContentApi } from "@/lib/content-api";
import { listContentPosts, proposeContentPost } from "@/lib/content-service";

/**
 * GET /api/content — list posts. Optional query: from, to (YYYY-MM-DD), status.
 * Read access for the brand-manager agent to see what's planned and posted.
 */
export async function GET(req: NextRequest) {
  const auth = authContentApi(req);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const url = req.nextUrl;
  const posts = await listContentPosts({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    status: url.searchParams.get("status"),
  });
  return NextResponse.json({ posts });
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

  const result = await proposeContentPost(body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json(
    { ...result.post, message: "Draft created — pending approval in the De Nada app." },
    { status: 201 }
  );
}
