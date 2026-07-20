/**
 * ElevenLabs text-to-speech for Nada's spoken replies.
 * Env (Render → Environment):
 *   ELEVENLABS_API_KEY   — from elevenlabs.io → Profile → API keys
 *   ELEVENLABS_VOICE_ID  — optional; defaults to the voice Adam picked
 *   ELEVENLABS_MODEL     — optional; defaults to eleven_multilingual_v2
 * Degrades gracefully: when unset or failing, the client falls back to the
 * browser's built-in synthesizer.
 */

import { getSetting } from "./settings";

const DEFAULT_VOICE = "6fZce9LFNG3iEITDfqZZ";

export function elevenEnabled(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

/** The voice in use: Settings pick first, then env override, then the default. */
export async function currentVoice(): Promise<{ id: string; source: "settings" | "server" | "default" }> {
  const chosen = (await getSetting("nada-voice-id").catch(() => "")).trim();
  if (chosen) return { id: chosen, source: "settings" };
  if (process.env.ELEVENLABS_VOICE_ID) return { id: process.env.ELEVENLABS_VOICE_ID, source: "server" };
  return { id: DEFAULT_VOICE, source: "default" };
}

export async function synthesize(text: string): Promise<Response> {
  const base = process.env.ELEVENLABS_API_URL || "https://api.elevenlabs.io";
  const voice = (await currentVoice()).id;
  return fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}`, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY!,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: text.slice(0, 2000),
      model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
}
