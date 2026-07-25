"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type FileStatus = { name: string; state: "uploading" | "staged" | "error"; detail?: string };

const KIND_LABEL: Record<string, string> = {
  COMMERCIAL_REPORT: "commercial report",
  LSI_INVENTORY: "LSI inventory workbook",
  QB_PNL: "QuickBooks P&L",
  AI_EXTRACT: "read by AI",
  UNKNOWN: "unrecognized",
};

/**
 * Drag a report anywhere onto the dashed area (or tap to browse) — each file
 * is staged in the Review Inbox for one-click approval. Used on every page
 * that consumes reports; nothing imports without review.
 */
export function DropZone({
  hint,
  importerId,
  accept = ".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt",
  compact = false,
}: {
  hint: string; // e.g. "Drop the LSI workbook here"
  importerId?: string;
  accept?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [files, setFiles] = useState<FileStatus[]>([]);
  const dragDepth = useRef(0);

  const upload = useCallback(
    async (list: FileList | File[]) => {
      const picked = [...list];
      if (picked.length === 0) return;
      setFiles((f) => [...f, ...picked.map((p) => ({ name: p.name, state: "uploading" as const }))]);

      let anyStaged = false;
      for (const file of picked) {
        const fd = new FormData();
        fd.set("file", file);
        if (importerId) fd.set("importerId", importerId);
        try {
          const res = await fetch("/api/ingest", { method: "POST", body: fd });
          const body = (await res.json().catch(() => ({}))) as { kind?: string; error?: string };
          setFiles((f) =>
            f.map((s) =>
              s.name === file.name && s.state === "uploading"
                ? res.ok
                  ? { name: s.name, state: "staged", detail: KIND_LABEL[body.kind ?? ""] ?? body.kind }
                  : { name: s.name, state: "error", detail: body.error ?? `Upload failed (${res.status})` }
                : s
            )
          );
          if (res.ok) anyStaged = true;
        } catch {
          setFiles((f) =>
            f.map((s) =>
              s.name === file.name && s.state === "uploading"
                ? { name: s.name, state: "error", detail: "Network problem — try again" }
                : s
            )
          );
        }
      }
      if (anyStaged) router.refresh();
    },
    [importerId, router]
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label={hint}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current++;
          setOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setOver(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setOver(false);
          upload(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-colors ${
          compact ? "gap-1 px-4 py-4" : "gap-2 px-6 py-8"
        } ${
          over
            ? "border-agave bg-agave/10"
            : "border-ink/20 bg-white/40 hover:border-agave/60 hover:bg-white/70"
        }`}
      >
        <svg
          width={compact ? 20 : 26}
          height={compact ? 20 : 26}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={over ? "text-agave" : "text-slate/50"}
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <div className={`font-medium text-ink/80 ${compact ? "text-xs" : "text-sm"}`}>{hint}</div>
        <div className="text-xs text-slate/60">or tap to browse</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs">
              {f.state === "uploading" && (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-[2px] border-agave/30 border-t-agave" />
              )}
              {f.state === "staged" && <span className="text-agave-deep">✓</span>}
              {f.state === "error" && <span className="text-burnt">✕</span>}
              <span className="truncate font-medium text-ink/80">{f.name}</span>
              <span className={f.state === "error" ? "text-burnt" : "text-slate/60"}>
                {f.state === "uploading"
                  ? "uploading…"
                  : f.state === "staged"
                    ? `staged for review${f.detail ? ` · ${f.detail}` : ""}`
                    : f.detail}
              </span>
            </li>
          ))}
          {files.some((f) => f.state === "staged") && (
            <li className="pt-0.5 text-xs text-slate/70">
              Review and approve in the{" "}
              <a href="/inbox" className="text-agave underline underline-offset-2">
                Review Inbox
              </a>
              .
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
