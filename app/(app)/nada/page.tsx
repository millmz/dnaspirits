import { requireOps } from "@/lib/auth";
import { agentEnabled } from "@/lib/agent";
import { elevenEnabled } from "@/lib/tts";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { NadaStage } from "@/components/nada-assistant";

/** Nada's own room — the talking agave, full size. */
export default async function NadaPage() {
  await requireOps();

  return (
    <div>
      <PageHeader
        label="Account"
        title="Ask Nada"
        subtitle="Your ops copilot — she knows the live numbers, remembers what you teach her, and talks back if you let her."
      />
      {agentEnabled() ? (
        <NadaStage elevenOn={elevenEnabled()} />
      ) : (
        <Card>
          <EmptyState>Nada needs ANTHROPIC_API_KEY set in Render to come to life.</EmptyState>
        </Card>
      )}
    </div>
  );
}
