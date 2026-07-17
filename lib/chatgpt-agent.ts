import { randomUUID } from "crypto";

/**
 * Outbound trigger for the De Nada brand-manager ChatGPT Workspace Agent.
 * This is the reverse direction of the MCP connector: here the PLATFORM
 * kicks off a run of the agent (e.g. "draft next month's posts"). The agent
 * then reads/writes the calendar back through the MCP endpoint, and its
 * proposals land in the approval queue on the Content page.
 *
 * Docs: POST https://api.chatgpt.com/v1/workspace_agents/{id}/trigger
 *   Authorization: Bearer <workspace-agent access token>
 *   body: { conversation_key, input }
 *   → 202 Accepted (durably queued, no body)
 *
 * The access token is a secret and lives ONLY in the CHATGPT_AGENT_TOKEN env
 * var (never in code or git). The trigger URL itself is not secret; it
 * defaults to De Nada's published agent and can be overridden via env.
 */

const DEFAULT_TRIGGER_URL =
  "https://api.chatgpt.com/v1/workspace_agents/agtch_6a59886ccea881919aa35bcaa7746564/trigger";

export function agentTriggerUrl(): string {
  return process.env.CHATGPT_AGENT_TRIGGER_URL || DEFAULT_TRIGGER_URL;
}

export function agentTriggerConfigured(): boolean {
  return Boolean(process.env.CHATGPT_AGENT_TOKEN);
}

/** A good default instruction the platform sends when asking for a month of posts. */
export function defaultDraftInstruction(monthLabel: string): string {
  return [
    `Plan De Nada Tequila's content for ${monthLabel}.`,
    "First call list_posts to see what is already on the calendar so you don't duplicate anything.",
    "Then propose 6–8 posts across the month with propose_post — spread them over the weeks.",
    "Give each a full publish-ready caption and hashtags in the De Nada voice: warm, host-first, never flashy; additive-free tequila made at NOM 1414; the bottle already on the counter, food and people just outside the frame.",
    "Every proposal is a draft for human approval — do not claim anything is scheduled or live.",
  ].join(" ");
}

export type TriggerResult = { ok: true } | { ok: false; error: string };

/**
 * Fire a run of the brand-manager agent. `conversationKey` threads related
 * triggers into one agent conversation (e.g. per month); a fresh idempotency
 * key is sent each call so every deliberate trigger actually enqueues.
 */
export async function triggerBrandManager(
  input: string,
  conversationKey: string
): Promise<TriggerResult> {
  const token = process.env.CHATGPT_AGENT_TOKEN;
  if (!token) {
    return { ok: false, error: "Brand-manager trigger is not configured (set CHATGPT_AGENT_TOKEN)." };
  }
  try {
    const res = await fetch(agentTriggerUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ conversation_key: conversationKey, input }),
      // don't hang a page action on a slow upstream
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 202 || res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    const detail = text ? `: ${text.slice(0, 200)}` : "";
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `ChatGPT rejected the access token (${res.status})${detail}` };
    }
    return { ok: false, error: `ChatGPT returned ${res.status}${detail}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Trigger request failed.";
    return { ok: false, error: msg };
  }
}
