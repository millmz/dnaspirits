"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls, btnCls } from "@/components/ui";
import { uploadFileToPost, postJson } from "@/lib/upload-client";

const MAX_ITEMS = 10;
const MAX_BYTES = 200 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime";
const OK_TYPES = ACCEPT.split(",");

type Picked = {
  file: File;
  url: string; // object URL for preview
  progress: number; // 0..1
  state: "queued" | "uploading" | "done" | "error";
  error?: string;
};

/**
 * Loomly-style composer: the post saves instantly as a small JSON request,
 * then each photo/video uploads separately in chunks with its own progress
 * bar and error. No giant all-or-nothing form post, no white screens.
 */
export function PostComposer({
  channels,
  defaultChannel,
  defaultDatetime,
  metaOn,
}: {
  channels: [string, string][];
  defaultChannel: string;
  defaultDatetime: string;
  metaOn: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (files: FileList | File[]) => {
    setError("");
    setSuccessMsg("");
    const next = [...picked];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_ITEMS) {
        setError(`Instagram allows up to ${MAX_ITEMS} items per post — extra files were skipped.`);
        break;
      }
      if (!OK_TYPES.includes(file.type)) {
        setError(`${file.name}: unsupported type — use JPG, PNG, GIF, WebP, MP4 or MOV.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError(`${file.name}: over the 200 MB limit.`);
        continue;
      }
      next.push({ file, url: URL.createObjectURL(file), progress: 0, state: "queued" });
    }
    setPicked(next);
  };

  const removeFile = (i: number) => {
    URL.revokeObjectURL(picked[i].url);
    setPicked(picked.filter((_, idx) => idx !== i));
  };

  const setItem = (i: number, patch: Partial<Picked>) =>
    setPicked((cur) => cur.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setSuccessMsg("");
    const form = new FormData(e.currentTarget);
    const val = (k: string) => String(form.get(k) ?? "").trim();
    if (!val("title")) {
      setError("Give the post a title.");
      return;
    }

    setBusy(true);
    setPhase("Saving post…");
    const created = await postJson("/api/posts", {
      title: val("title"),
      datetime: val("datetime"),
      channel: val("channel"),
      status: val("status"),
      caption: val("caption"),
      hashtags: val("hashtags"),
      assetUrl: val("assetUrl"),
      notes: val("notes"),
      autoPublish: form.get("autoPublish") === "on",
    });
    if (!created.ok || typeof created.id !== "string") {
      setBusy(false);
      setPhase("");
      setError(created.error || "Could not save the post.");
      return;
    }
    const postId = created.id;

    let failed = 0;
    for (let i = 0; i < picked.length; i++) {
      setPhase(`Uploading ${i + 1} of ${picked.length}…`);
      setItem(i, { state: "uploading", progress: 0 });
      const r = await uploadFileToPost(postId, picked[i].file, (f) => setItem(i, { progress: f }));
      if (r.ok) {
        setItem(i, { state: "done", progress: 1 });
      } else {
        failed++;
        setItem(i, { state: "error", error: r.error });
      }
    }

    setBusy(false);
    setPhase("");
    if (failed === 0) {
      picked.forEach((p) => URL.revokeObjectURL(p.url));
      setPicked([]);
      (e.target as HTMLFormElement).reset?.();
      setSuccessMsg(
        picked.length > 0
          ? `Post saved with ${picked.length} file${picked.length === 1 ? "" : "s"} — it's on the calendar.`
          : "Post saved — it's on the calendar."
      );
      router.refresh();
    } else {
      setError(
        `The post was saved, but ${failed} file${failed === 1 ? "" : "s"} failed to upload — see below. ` +
          "You can add media from the post's card once the issue is fixed."
      );
      router.refresh();
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <div className="rounded-md bg-burnt/10 px-3 py-2 text-sm text-burnt">{error}</div>}
      {successMsg && <div className="rounded-md bg-agave/10 px-3 py-2 text-sm text-agave-deep">{successMsg}</div>}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate">Working title</span>
        <input name="title" required placeholder="Paloma recipe reel — backyard table" className={inputCls} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate">Post date &amp; time</span>
          <input name="datetime" type="datetime-local" defaultValue={defaultDatetime} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate">Channel</span>
          <select name="channel" defaultValue={defaultChannel} className={inputCls}>
            {channels.map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate">Status</span>
        <select name="status" defaultValue="SCHEDULED" className={inputCls}>
          <option value="IDEA">Idea</option>
          <option value="DRAFTED">Drafted</option>
          <option value="SCHEDULED">Scheduled</option>
        </select>
      </label>

      {/* media picker: drag & drop + browse, with previews and per-file progress */}
      <div>
        <span className="mb-1 block text-xs font-medium text-slate">Photos / videos (up to {MAX_ITEMS})</span>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          onClick={() => fileInput.current?.click()}
          className={`cursor-pointer rounded-md border-2 border-dashed px-3 py-4 text-center text-sm transition-colors ${
            dragOver ? "border-agave bg-agave/5 text-agave-deep" : "border-ink/15 bg-white/50 text-slate/70 hover:border-agave/50"
          }`}
        >
          <span className="font-medium text-agave-deep">Tap to add</span> or drag files here — 2+ makes a
          swipe carousel, first is the cover
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
          />
        </div>

        {picked.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {picked.map((p, i) => (
              <div key={p.url} className="flex items-center gap-2 rounded-md border border-ink/10 bg-white/70 p-1.5">
                {p.file.type.startsWith("video/") ? (
                  <video src={p.url} className="h-12 w-12 shrink-0 rounded object-cover" muted />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium">{p.file.name}</span>
                    <span className="shrink-0 text-[10px] text-slate/60">
                      {i === 0 ? "cover · " : ""}{(p.file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                  {p.state === "uploading" && (
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
                      <div className="h-full rounded-full bg-agave transition-all" style={{ width: `${Math.round(p.progress * 100)}%` }} />
                    </div>
                  )}
                  {p.state === "done" && <div className="mt-0.5 text-[10px] font-medium text-agave-deep">Uploaded ✓</div>}
                  {p.state === "error" && <div className="mt-0.5 text-[10px] font-medium text-burnt">{p.error}</div>}
                </div>
                {!busy && (
                  <button type="button" onClick={() => removeFile(i)} className="shrink-0 px-1.5 text-xs text-slate/60 hover:text-burnt" aria-label={`Remove ${p.file.name}`}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate">Caption</span>
        <textarea name="caption" rows={3} placeholder="Full caption in the De Nada voice" className={inputCls} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate">Hashtags</span>
          <input name="hashtags" placeholder="#DeNada #tequila" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate">External asset link (optional)</span>
          <input name="assetUrl" placeholder="https://…" className={inputCls} />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate">Art-direction notes</span>
        <textarea name="notes" rows={2} className={inputCls} />
      </label>

      {metaOn && (
        <label className="flex items-center gap-2 text-sm text-ink/85">
          <input type="checkbox" name="autoPublish" defaultChecked className="h-4 w-4 accent-agave" />
          Auto-post to Instagram/Facebook at the scheduled time
        </label>
      )}

      <button type="submit" disabled={busy} className={`${btnCls} disabled:cursor-not-allowed disabled:opacity-60`}>
        {busy ? phase || "Working…" : "Add to calendar"}
      </button>
      <p className="text-xs text-slate/70">
        Scheduled posts with auto-post on go live within a minute of their date &amp; time. Art
        direction cue: the bottle already on the counter — food, prep, people.
      </p>
    </form>
  );
}

/** Compact uploader for adding media to an existing (unpublished) post. */
export function AddMedia({ postId, room }: { postId: string; room: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");

  async function handle(files: FileList) {
    const list = Array.from(files).slice(0, room);
    setState("uploading");
    setMsg("");
    for (let i = 0; i < list.length; i++) {
      setProgress(0);
      setMsg(list.length > 1 ? `Uploading ${i + 1}/${list.length}…` : "Uploading…");
      const r = await uploadFileToPost(postId, list[i], setProgress);
      if (!r.ok) {
        setState("error");
        setMsg(`${list[i].name}: ${r.error}`);
        router.refresh();
        return;
      }
    }
    setState("idle");
    setMsg("");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) handle(e.target.files); e.target.value = ""; }}
      />
      {state === "uploading" ? (
        <div className="w-28">
          <div className="text-[10px] text-slate/70">{msg}</div>
          <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-agave transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} className="brand-heading text-[10px] text-agave hover:underline">
          + Add to carousel
        </button>
      )}
      {state === "error" && <div className="max-w-48 text-[10px] font-medium text-burnt">{msg}</div>}
    </div>
  );
}
