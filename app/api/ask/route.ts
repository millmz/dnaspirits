import { apiOpsUser } from "@/lib/api-auth";
import { askPlatform, type AskTurn } from "@/lib/ask";

export async function POST(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;
  let body: { question?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request body." }, { status: 400 });
  }
  const question = String(body.question ?? "").trim().slice(0, 1000);
  if (!question) return Response.json({ ok: false, error: "Ask something." }, { status: 400 });
  const history: AskTurn[] = Array.isArray(body.history)
    ? body.history
        .filter(
          (t): t is { role: string; content: string } =>
            !!t && typeof t === "object" && typeof (t as { content?: unknown }).content === "string"
        )
        .map((t) => ({
          role: t.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: t.content.slice(0, 4000),
        }))
        .slice(-12)
    : [];
  const r = await askPlatform(question, history);
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
