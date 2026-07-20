import Link from "next/link";
import { requireOps } from "@/lib/auth";
import { agentEnabled } from "@/lib/agent";
import { elevenEnabled } from "@/lib/tts";
import { NadaStage } from "@/components/nada-assistant";

/** Nada's room — a full-screen stage of her own, outside the ops shell. */
export default async function NadaPage() {
  await requireOps();

  if (!agentEnabled()) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink font-mono text-sm text-cream/70">
        <p>nada is offline — ANTHROPIC_API_KEY is not set on the server.</p>
        <Link href="/" className="text-agave hover:text-cream">
          [ ← back to ops ]
        </Link>
      </div>
    );
  }

  return <NadaStage elevenOn={elevenEnabled()} />;
}
