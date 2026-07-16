import Anthropic from "@anthropic-ai/sdk";

/**
 * Optional Claude layer for the ingestion agent. Everything here is gated on
 * ANTHROPIC_API_KEY and degrades gracefully: if the key is absent or the call
 * fails, the caller falls back to the deterministic summary. The deterministic
 * parse + anomaly detection carry the load; this adds narrative and reads
 * unstructured PDFs (permits, invoices) the structured parsers can't.
 */

export const agentEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

const SYSTEM =
  "You are the operations analyst for De Nada Tequila (DNA Spirits LLC), a tequila brand " +
  "that produces in Mexico and sells ex-works to a US importer (LSI). You review documents " +
  "before they're imported into the ops platform. Write a tight, plain-English review note " +
  "(2-4 sentences) for the founder: what this document is, what will be imported, and — most " +
  "importantly — anything that looks off or worth a second look. Be specific and factual. " +
  "No preamble, no bullet lists, no restating the filename.";

type SummaryInput = {
  kind: string;
  filename: string;
  facts: string;
  anomalies: string[];
  pdfBase64?: string; // attached for UNKNOWN documents so Claude can read them
};

/** Writes a review narrative; returns null if the agent is disabled or errors. */
export async function writeReviewNote(input: SummaryInput): Promise<string | null> {
  if (!agentEnabled()) return null;
  try {
    const client = new Anthropic();
    const content: Anthropic.ContentBlockParam[] = [];
    if (input.pdfBase64) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: input.pdfBase64 },
      });
    }
    content.push({
      type: "text",
      text:
        `Document: ${input.filename}\nDetected type: ${input.kind}\n\n` +
        `Parsed facts:\n${input.facts}\n\n` +
        `Automated anomaly flags:\n${input.anomalies.length ? input.anomalies.join("\n") : "none"}\n\n` +
        (input.kind === "UNKNOWN"
          ? "This document wasn't one of the known report formats. Read the attached PDF, say what it is (permit, invoice, certificate, etc.) and the key fields, and note what the team should do with it."
          : "Write the review note."),
    });

    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 700,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch (e) {
    console.error("agent review note failed:", e);
    return null;
  }
}
