import { apiOpsUser } from "@/lib/api-auth";
import { askPlatform } from "@/lib/ask";

export async function POST(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;
  let body: { question?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request body." }, { status: 400 });
  }
  const question = String(body.question ?? "").trim().slice(0, 1000);
  if (!question) return Response.json({ ok: false, error: "Ask something." }, { status: 400 });
  const r = await askPlatform(question);
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
