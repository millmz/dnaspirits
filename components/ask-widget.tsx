"use client";

import { useState } from "react";
import { inputCls, btnCls } from "@/components/ui";
import { postJson } from "@/lib/upload-client";

/** Dashboard "ask anything" box answered from live platform data. */
export function AskWidget() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !q.trim()) return;
    setBusy(true);
    setAnswer("");
    setError("");
    const r = (await postJson("/api/ask", { question: q })) as { ok: boolean; answer?: string; error?: string };
    setBusy(false);
    if (r.ok && r.answer) setAnswer(r.answer);
    else setError(r.error || "Ask failed.");
  }

  return (
    <div className="mb-5 rounded-lg border border-agave/25 bg-white/70 p-4">
      <form onSubmit={ask} className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Ask your data anything — "how many cases did we deplete this year?"'
          className={inputCls}
        />
        <button disabled={busy} className={`${btnCls} shrink-0 disabled:opacity-60`}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-burnt">{error}</p>}
      {answer && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/90">{answer}</p>}
    </div>
  );
}
