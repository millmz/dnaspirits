import Anthropic from "@anthropic-ai/sdk";
import { agentEnabled } from "./agent";

/**
 * AI caption writer for the content calendar — takes an optional image plus
 * a short brief and returns ready-to-use caption options in the De Nada
 * voice. Gated on ANTHROPIC_API_KEY like the rest of the Claude layer.
 */

const SYSTEM =
  "You write Instagram/Facebook captions for De Nada Tequila, a premium additive-free tequila " +
  "brand from the founders Danny & Adam. The voice: warm, host-first, generous, never flashy or " +
  "salesy — the feeling of being welcomed to a friend's table. 'De nada' as in 'you're welcome.' " +
  "Write like a person, not a brand account. Short sentences. No emoji walls (0-2 emoji max). " +
  "Each option should feel distinct: one shorter and punchy, one more storytelling, one playful. " +
  "Hashtags: 5-10, always including #DeNada and #tequila, the rest specific to the content.";

const SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["options"],
  properties: {
    options: {
      type: "array" as const,
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["caption", "hashtags"],
        properties: {
          caption: { type: "string" as const, description: "The caption text, no hashtags in it" },
          hashtags: { type: "string" as const, description: "Space-separated hashtags starting with #" },
        },
      },
    },
  },
};

export type CaptionOption = { caption: string; hashtags: string };

export async function generateCaptions(
  brief: string,
  imageBase64?: { data: string; mime: string }
): Promise<{ ok: true; options: CaptionOption[] } | { ok: false; error: string }> {
  if (!agentEnabled()) return { ok: false, error: "AI is not configured (ANTHROPIC_API_KEY)." };
  try {
    const client = new Anthropic();
    const content: Anthropic.ContentBlockParam[] = [];
    if (imageBase64) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: imageBase64.mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: imageBase64.data,
        },
      });
    }
    content.push({
      type: "text",
      text:
        (imageBase64 ? "Write captions for the attached photo.\n" : "") +
        (brief.trim() ? `Brief / working title / notes from the team:\n${brief.trim()}` : "No brief — go from the image."),
    });

    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1500,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = JSON.parse(text) as { options: CaptionOption[] };
    if (!parsed.options?.length) return { ok: false, error: "The AI returned no options — try again." };
    return { ok: true, options: parsed.options.slice(0, 3) };
  } catch (e) {
    console.error("caption generation failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Caption generation failed." };
  }
}
