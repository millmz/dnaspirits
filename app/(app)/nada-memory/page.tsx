import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { listMemories, saveMemory, deleteMemory, MEMORY_TYPES } from "@/lib/nada-memory";
import { PageHeader, Card, Badge, Field, inputCls, EmptyState, Callout } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

async function addMemory(formData: FormData) {
  "use server";
  const admin = await requireAdmin();
  const r = saveMemory({
    type: String(formData.get("type") ?? "FACT"),
    hook: String(formData.get("hook") ?? ""),
    body: String(formData.get("body") ?? ""),
    taughtBy: admin.name,
  });
  redirect(r.saved ? "/nada-memory?ok=Saved" : `/nada-memory?err=${encodeURIComponent(r.reason)}`);
}

async function removeMemory(formData: FormData) {
  "use server";
  await requireAdmin();
  deleteMemory(String(formData.get("id")));
  redirect("/nada-memory?ok=Forgotten");
}

const TYPE_TONE: Record<string, "green" | "blue" | "amber" | "gray"> = {
  FACT: "green",
  PREFERENCE: "blue",
  PROJECT: "amber",
  POINTER: "gray",
};

/**
 * Nada's long-term memory, laid open: every memory is a readable file you can
 * add to, inspect, or delete. The files are the source of truth.
 */
export default async function NadaMemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requireAdmin();
  const { ok, err } = await searchParams;
  const memories = listMemories();

  return (
    <div>
      <PageHeader
        label="Admin"
        title="Nada's Memory"
        subtitle="Everything Nada has learned. Review, teach, or remove."
      />

      {ok && <div className="mb-4"><Callout tone="green">{ok}</Callout></div>}
      {err && <div className="mb-4"><Callout tone="amber">{err}</Callout></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {memories.length === 0 ? (
            <Card>
              <EmptyState>
                Nothing learned yet. Teach Nada in conversation (&ldquo;remember this: …&rdquo;) or add a
                memory on the right. After real conversations, the extractor also saves durable facts on
                its own.
              </EmptyState>
            </Card>
          ) : (
            memories.map((m) => (
              <div key={m.id} className="rounded-lg border border-ink/10 bg-white/70 p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TYPE_TONE[m.type] ?? "gray"}>{m.type}</Badge>
                  <span className="flex-1 text-sm font-medium">{m.hook}</span>
                  <span className="text-[10px] text-slate/60">
                    {m.taughtBy || "unknown"} · {m.created.slice(0, 10)} · <span className="font-mono">{m.id}</span>
                  </span>
                  <form action={removeMemory}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="px-1 py-1.5 text-xs text-slate/50 transition-colors hover:text-burnt">Forget</button>
                  </form>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink/85">{m.body}</p>
              </div>
            ))
          )}
        </div>

        <Card title="Teach Nada something" collapsible>
          <form action={addMemory} className="space-y-3">
            <Field label="Type">
              <select name="type" className={inputCls}>
                {MEMORY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === "FACT" ? "Fact (about you / the business)" : t === "PREFERENCE" ? "Preference (how to work)" : t === "PROJECT" ? "Project (active work)" : "Pointer (external resource)"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Hook (one searchable line)">
              <input name="hook" required placeholder="Danny handles distributor relationships" className={inputCls} />
            </Field>
            <Field label="Body (why it matters, how to apply it)">
              <textarea name="body" rows={4} required className={inputCls} />
            </Field>
            <SubmitButton>Save memory</SubmitButton>
            <p className="text-xs text-slate/70">
              Never store secrets, credentials, or personal data beyond business context — Nada is
              built to refuse those, and so should we.
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
