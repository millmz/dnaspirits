import { apiOpsUser } from "@/lib/api-auth";
import { currentVoice, elevenEnabled, synthesize } from "@/lib/tts";

function explainStatus(status: number): string {
  if (status === 401) return "the API key is invalid or was revoked";
  if (status === 403) return "the API key is not allowed to use Text to Speech — check the key's restrictions on elevenlabs.io";
  if (status === 404) return "the voice ID was not found — check ELEVENLABS_VOICE_ID";
  if (status === 402 || status === 429) return "the ElevenLabs account is out of credits or rate limited";
  return `ElevenLabs returned ${status}`;
}

/** Voice health check: is ElevenLabs configured, and does a live synth work? */
export async function GET(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;
  if (!elevenEnabled()) {
    return Response.json({
      ok: true,
      configured: false,
      hint: "ELEVENLABS_API_KEY is not set on the server. Add it in Render → denada-ops → Environment.",
    });
  }
  const v = await currentVoice();
  const voice = v.source === "settings" ? `${v.id} (picked in Settings)` : v.source === "server" ? v.id : "default";
  const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
  try {
    const r = await synthesize("ok");
    if (r.ok) {
      // drain the tiny test clip so the connection closes cleanly
      await r.arrayBuffer().catch(() => undefined);
      return Response.json({ ok: true, configured: true, working: true, voice, model });
    }
    const detail = await r.text().catch(() => "");
    console.error("tts check: ElevenLabs error", r.status, detail.slice(0, 300));
    return Response.json({ ok: true, configured: true, working: false, voice, model, status: r.status, hint: explainStatus(r.status) });
  } catch (e) {
    console.error("tts check failed:", e);
    return Response.json({ ok: true, configured: true, working: false, voice, model, hint: "could not reach ElevenLabs from the server" });
  }
}

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
      return Response.json({ ok: false, error: explainStatus(r.status) }, { status: 502 });
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
