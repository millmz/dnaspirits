import { db } from "@/lib/db";
import { apiOpsUser } from "@/lib/api-auth";
import { askPlatform, getLatestSession } from "@/lib/ask";

/** Ask Nada. Sessions persist server-side; the client only holds a session id. */
export async function POST(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;
  let body: { question?: unknown; sessionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request body." }, { status: 400 });
  }
  const question = String(body.question ?? "").trim().slice(0, 1000);
  if (!question) return Response.json({ ok: false, error: "Ask something." }, { status: 400 });
  const sessionId = typeof body.sessionId === "string" && /^[a-z0-9]+$/i.test(body.sessionId) ? body.sessionId : undefined;
  const user = await db.user.findUnique({ where: { id: auth.userId }, select: { name: true } });
  const r = await askPlatform(question, { sessionId, userName: user?.name ?? "" });
  return Response.json(r, { status: r.ok ? 200 : 502 });
}

/** Resume: the most recent conversation (last 24h), so a reload keeps the thread. */
export async function GET(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;
  const latest = await getLatestSession();
  return Response.json({ ok: true, session: latest });
}
