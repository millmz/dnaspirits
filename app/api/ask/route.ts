import { db } from "@/lib/db";
import { apiOpsUser } from "@/lib/api-auth";
import { askPlatform, getLatestSession, closeOpenSessions } from "@/lib/ask";
import { repairTranscript } from "@/lib/voice-repair";

/** Ask Nada. Sessions persist server-side; the client only holds a session id. */
export async function POST(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;
  let body: { question?: unknown; sessionId?: unknown; voice?: unknown; alternatives?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request body." }, { status: 400 });
  }
  const asked = String(body.question ?? "").trim().slice(0, 1000);
  if (!asked) return Response.json({ ok: false, error: "Ask something." }, { status: 400 });
  const sessionId = typeof body.sessionId === "string" && /^[a-z0-9]+$/i.test(body.sessionId) ? body.sessionId : undefined;
  const user = await db.user.findUnique({ where: { id: auth.userId }, select: { name: true } });

  // Spoken input is repaired against the live business vocabulary before it
  // reaches her brain — the recognizer mangles reposado, ex-works, LSI and the
  // distributor names, and answering the mangled version answers the wrong
  // question. Typed input is already exact and is never touched.
  let question = asked;
  let heard: string | undefined;
  if (body.voice === true) {
    const alternatives = Array.isArray(body.alternatives)
      ? body.alternatives.filter((a): a is string => typeof a === "string").slice(0, 4).map((a) => a.slice(0, 1000))
      : [];
    const prior = sessionId
      ? await db.nadaTurn.findMany({
          where: { sessionId },
          orderBy: { createdAt: "desc" },
          take: 4,
          select: { role: true, content: true },
        })
      : [];
    const repair = await repairTranscript(asked, { alternatives, recentTurns: prior.reverse() });
    question = repair.text;
    if (repair.changed) heard = repair.raw;
  }

  const r = await askPlatform(question, { sessionId, userName: user?.name ?? "" });
  return Response.json(r.ok ? { ...r, question, heard } : r, { status: r.ok ? 200 : 502 });
}

/** Resume: the most recent conversation (last 24h), so a reload keeps the thread. */
export async function GET(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;
  const latest = await getLatestSession();
  return Response.json({ ok: true, session: latest });
}

/** New conversation: close every open session server-side so nothing resumes — ever. */
export async function DELETE(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;
  const closed = await closeOpenSessions();
  return Response.json({ ok: true, closed });
}
