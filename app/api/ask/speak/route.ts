import { apiOpsUser } from "@/lib/api-auth";
import { elevenEnabled, synthesize } from "@/lib/tts";

/** Nada's voice: turns an answer into audio via ElevenLabs. */
export async function POST(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;
  if (!elevenEnabled()) {
    return Response.json({ ok: false, error: "ElevenLabs is not configured." }, { status: 501 });
  }
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request body." }, { status: 400 });
  }
  const text = String(body.text ?? "").trim();
  if (!text) return Response.json({ ok: false, error: "Nothing to say." }, { status: 400 });

  try {
    const r = await synthesize(text);
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("tts: ElevenLabs error", r.status, detail.slice(0, 300));
      return Response.json({ ok: false, error: `Voice service returned ${r.status}.` }, { status: 502 });
    }
    return new Response(r.body, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("tts failed:", e);
    return Response.json({ ok: false, error: "Voice synthesis failed." }, { status: 502 });
  }
}
