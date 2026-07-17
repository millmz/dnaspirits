import { redirect } from "next/navigation";

/**
 * Next.js implements redirect() and notFound() by THROWING a special error
 * that the framework catches. Our own try/catch around a server action must
 * re-throw those, or navigation silently breaks.
 */
export function isControlFlowError(e: unknown): boolean {
  const digest = (e as { digest?: unknown })?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

/**
 * Run a server action's body; if it throws a real error (not a redirect),
 * log it and bounce back to `path` with the message in a readable ?err
 * banner instead of white-screening the user with "This page couldn't load".
 */
export async function guardAction(path: string, label: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (e) {
    if (isControlFlowError(e)) throw e; // let redirect()/notFound() through
    console.error(`${label} failed:`, e);
    const msg = e instanceof Error ? e.message : "Unexpected error";
    redirect(`${path}?err=${encodeURIComponent(`Couldn't ${label}: ${msg}`)}`);
  }
}
