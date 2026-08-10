import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { agentEnabled } from "./agent";

/**
 * Speech repair for Nada's voice input.
 *
 * Browser speech recognition is trained on general English, so De Nada's
 * working vocabulary — reposado, añejo, ex-works, depletions, LSI, Vivanco,
 * distributor names — comes back mangled ("repo sado", "else I", "x works").
 * Answering the mangled text produces a confidently wrong answer, which is
 * worse than admitting confusion.
 *
 * So a voice turn goes through two passes before it reaches her brain:
 *   1. A deterministic pass for manglings that are unambiguous in this domain.
 *      Instant, free, and works even when the API is down.
 *   2. A fast model pass that sees the live business vocabulary, the browser's
 *      alternative guesses, and the last couple of turns, and rewrites the
 *      transcript into the question most likely to have been asked.
 *
 * Everything degrades to the raw transcript: any failure, timeout, or
 * low-confidence result returns exactly what was heard. The repair may only
 * fix how words were *heard* — never change the substance of the question,
 * never answer it, never invent a business entity that doesn't exist.
 */

export type RepairResult = {
  text: string; // what to actually answer
  raw: string; // what the browser heard
  changed: boolean;
};

/**
 * Manglings that are unambiguous in De Nada's context. Kept deliberately
 * narrow — anything that could be a legitimate English phrase is left for the
 * model pass, which has context to judge it.
 */
const RULES: [RegExp, string][] = [
  [/\b(?:the|day|da|dee)[\s-]?nada\b/gi, "De Nada"],
  [/\bde[\s-]?nada\b/gi, "De Nada"],
  [/\brepo[\s-]?sa[dt]{1,2}o\b/gi, "reposado"],
  [/\brepo[\s-]?sotto\b/gi, "reposado"],
  [/\breposada\b/gi, "reposado"],
  [/\ban(?:\s|-)?ye?[\s-]?ho\b/gi, "añejo"],
  [/\ba[\s-]?nacho\b/gi, "añejo"],
  [/\banejo\b/gi, "añejo"],
  [/\bblank[\s-]?o\b/gi, "blanco"],
  [/\b(?:e?x)[\s-]works?\b/gi, "ex-works"],
  [/\bcharge[\s-]backs\b/gi, "chargebacks"],
  [/\bcharge[\s-]back\b/gi, "chargeback"],
  [/\bpro[\s-]forma\b/gi, "proforma"],
  [/\bper[\s-]?forma\b/gi, "proforma"],
  // trailing "." is consumed too, so "l.s.i." doesn't leave a stray period
  [/\bl\.?\s?s\.?\s?i\.?(?!\w)/gi, "LSI"],
  [/\b(?:else|elsie|alexi)\s+(?:i|eye)\b/gi, "LSI"],
  [/\bdeep\s+(?:lesions|listens)\b/gi, "depletions"],
  [/\bviv[ao]nc?[oa]\b/gi, "Vivanco"],
];

/** Pass 1 — deterministic, instant, no network. */
export function repairKnownTerms(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement as string);
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * The live business vocabulary the recognizer has never heard of. Pulled from
 * the database so it stays true as products, distributors and markets change.
 */
export async function brandVocabulary(): Promise<string> {
  const [products, distributors, importers, warehouses, markets] = await Promise.all([
    db.product.findMany({ where: { active: true }, select: { sku: true, name: true } }),
    db.distributor.findMany({ select: { name: true, market: true } }),
    db.importer.findMany({ select: { name: true } }),
    db.warehouse.findMany({ select: { name: true } }),
    db.marketSnapshot.findMany({ select: { market: true }, distinct: ["market"] }),
  ]);
  const lines = [
    `Products: ${products.map((p) => `${p.name} (${p.sku})`).join("; ") || "none yet"}`,
    `Importer: ${importers.map((i) => i.name).join("; ") || "none yet"}`,
    `Distributors: ${distributors.map((d) => (d.market ? `${d.name} [${d.market}]` : d.name)).join("; ") || "none yet"}`,
    `Warehouses: ${warehouses.map((w) => w.name).join("; ") || "none yet"}`,
    `States in distribution: ${markets.map((m) => m.market).join(", ") || "none yet"}`,
    "Everyday terms: ex-works, depletions, chargeback, trade spend, proforma, " +
      "physical cases, SKU, BOM, dry goods, blanco, reposado, añejo, receivables, " +
      "velocity, weeks in market, NOM 1414, Vivanco (the distillery), Danny and Adam (the founders).",
  ];
  return lines.join("\n");
}

const SYSTEM =
  "You clean up speech-recognition transcripts for De Nada Tequila's operations assistant. " +
  "The speaker is a founder asking about their own business out loud; the recognizer is " +
  "general-purpose English and mangles industry and brand words.\n\n" +
  "Return the question the speaker most likely actually asked.\n\n" +
  "Rules, in order of importance:\n" +
  "1. Fix only how words were HEARD. Never change what is being asked, never add or drop a " +
  "condition, never answer the question, never make it more specific than it was.\n" +
  "2. Prefer the provided vocabulary when a garbled word is plainly a mishearing of one of " +
  "those names or terms. Do NOT invent a product, distributor, state or person that isn't listed.\n" +
  "3. The recognizer's alternative guesses are hints — if one of them reads as a more sensible " +
  "business question than the top guess, use it.\n" +
  "4. Use the recent conversation to resolve follow-ups and pronouns in the WORDING only " +
  "(e.g. hearing 'what about a pearl' right after a March question likely means 'what about April'). " +
  "Never merge the previous question into this one.\n" +
  "5. If the transcript already reads as a sensible question, or you are not reasonably confident " +
  "what was meant, return it completely unchanged. A wrong 'fix' is worse than leaving it alone.\n" +
  "6. Keep it in the speaker's own voice and register. Don't make it formal, don't add politeness, " +
  "don't add punctuation beyond what aids reading.";

const SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["corrected", "confident"],
  properties: {
    corrected: {
      type: "string" as const,
      description: "The question as most likely spoken. Identical to the input when nothing needed fixing.",
    },
    confident: {
      type: "boolean" as const,
      description: "False when unsure what was meant — the raw transcript is then used instead.",
    },
  },
};

const MAX_MS = 6000; // never let repair hold up an answer for long

/**
 * Pass 2 — the model pass. Returns the raw transcript unchanged on any
 * failure, timeout, low confidence, or absurd rewrite.
 */
export async function repairTranscript(
  rawTranscript: string,
  opts: { alternatives?: string[]; recentTurns?: { role: string; content: string }[] } = {}
): Promise<RepairResult> {
  const raw = rawTranscript.trim();
  const deterministic = repairKnownTerms(raw);
  const fallback: RepairResult = { text: deterministic, raw, changed: deterministic !== raw };
  if (!agentEnabled() || raw.length < 2) return fallback;

  try {
    const [vocabulary] = await Promise.all([brandVocabulary()]);
    const alts = (opts.alternatives ?? []).map((a) => a.trim()).filter((a) => a && a !== raw).slice(0, 4);
    const context = (opts.recentTurns ?? [])
      .slice(-4)
      .map((t) => `${t.role === "user" ? "Founder" : "Nada"}: ${t.content.slice(0, 300)}`)
      .join("\n");

    const client = new Anthropic();
    const resp = await client.messages.create(
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content:
              `Business vocabulary:\n${vocabulary}\n\n` +
              (context ? `Recent conversation:\n${context}\n\n` : "") +
              `Recognizer's top guess:\n"${deterministic}"\n\n` +
              (alts.length ? `Recognizer's other guesses:\n${alts.map((a) => `- "${a}"`).join("\n")}\n\n` : "") +
              `What did the founder most likely ask?`,
          },
        ],
      },
      { timeout: MAX_MS }
    );

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) return fallback;
    const parsed = JSON.parse(text) as { corrected?: string; confident?: boolean };
    const corrected = (parsed.corrected ?? "").trim();

    if (!corrected || parsed.confident === false) return fallback;
    // guard against a runaway rewrite: a repair should be about the same size
    if (corrected.length > deterministic.length * 2.5 + 40) return fallback;

    return { text: corrected, raw, changed: corrected !== raw };
  } catch (e) {
    console.error("voice repair failed (using raw transcript):", e);
    return fallback;
  }
}
