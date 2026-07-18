"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/upload-client";

type Hit = { type: string; label: string; sub: string; href: string };

/** Global search: ⌘K / Ctrl+K anywhere, or the floating button on mobile. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else {
      setQ("");
      setHits([]);
    }
  }, [open]);

  const search = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setBusy(true);
      const r = (await postJson("/api/search", { q: value })) as { ok: boolean; hits?: Hit[] };
      setBusy(false);
      if (r.ok && r.hits) setHits(r.hits);
    }, 250);
  };

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      {/* mobile trigger — bottom-left, mirrors the content FAB on the right */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="fixed bottom-5 left-5 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-cream shadow-xl active:scale-95 lg:hidden print:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-ink/40 p-4 pt-[12vh] print:hidden" onClick={() => setOpen(false)}>
          <div className="mx-auto max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (hits[0]) go(hits[0].href);
              }}
            >
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => search(e.target.value)}
                placeholder="Search products, lots, POs, invoices, posts…"
                className="w-full border-b border-ink/10 px-4 py-3 text-base outline-none sm:text-sm"
              />
            </form>
            <div className="max-h-80 overflow-y-auto">
              {busy && <div className="px-4 py-3 text-sm text-slate/60">Searching…</div>}
              {!busy && q.trim().length >= 2 && hits.length === 0 && (
                <div className="px-4 py-3 text-sm text-slate/60">Nothing found for &ldquo;{q}&rdquo;.</div>
              )}
              {hits.map((h, i) => (
                <button
                  key={`${h.href}-${i}`}
                  onClick={() => go(h.href)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-agave/10"
                >
                  <span className="w-20 shrink-0 text-[10px] font-medium uppercase tracking-wide text-agave-deep">{h.type}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{h.label}</span>
                    {h.sub && <span className="block truncate text-xs text-slate/60">{h.sub}</span>}
                  </span>
                  {i === 0 && <span className="shrink-0 text-[10px] text-slate/40">↵</span>}
                </button>
              ))}
            </div>
            <div className="border-t border-ink/10 px-4 py-2 text-[10px] text-slate/50">
              ⌘K to open anywhere · Enter opens the top result · Esc closes
            </div>
          </div>
        </div>
      )}
    </>
  );
}
