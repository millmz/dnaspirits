import { db } from "@/lib/db";
import { toDate } from "@/lib/format";
import { apiOpsUser } from "@/lib/api-auth";

const CHANNELS = ["IG_FB", "INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "EMAIL", "OTHER"];
const STATUSES = ["IDEA", "DRAFTED", "SCHEDULED"];

/**
 * Create a post's metadata (small JSON request — never carries files).
 * Media attaches afterwards via /api/posts/[id]/media chunk uploads.
 */
export async function POST(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request body." }, { status: 400 });
  }

  const s = (k: string, max = 5000) => String(body[k] ?? "").trim().slice(0, max);
  const title = s("title", 300);
  if (!title) return Response.json({ ok: false, error: "Give the post a title." }, { status: 400 });

  try {
    const post = await db.socialPost.create({
      data: {
        title,
        date: toDate(s("datetime", 40)),
        channel: CHANNELS.includes(s("channel", 20)) ? s("channel", 20) : "INSTAGRAM",
        status: STATUSES.includes(s("status", 20)) ? s("status", 20) : "IDEA",
        caption: s("caption"),
        hashtags: s("hashtags", 1000),
        assetUrl: s("assetUrl", 1000),
        notes: s("notes"),
        autoPublish: body.autoPublish === true,
      },
    });
    return Response.json({ ok: true, id: post.id });
  } catch (e) {
    console.error("api/posts create failed:", e);
    const msg = e instanceof Error ? e.message : "Could not save the post.";
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
