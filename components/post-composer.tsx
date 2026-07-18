"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls, btnCls } from "@/components/ui";
import { uploadFileToPost, postJson } from "@/lib/upload-client";

const MAX_ITEMS = 10;
const MAX_BYTES = 200 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime";
const OK_TYPES = ACCEPT.split(",");
const META_CHANNELS = ["IG_FB", "INSTAGRAM", "FACEBOOK"];

type Picked = {
  file: File;
  url: string;
  progress: number;
  state: "queued" | "uploading" | "done" | "error";
  error?: string;
};

type CaptionOption = { caption: string; hashtags: string };

/** Downscale an image in the browser so the AI request stays small. */
async function downscaleForAi(file: File): Promise<{ data: string; mime: string } | undefined> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return undefined;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    return { data: dataUrl.split(",")[1], mime: "image/jpeg" };
  } catch {
    return undefined;
  }
}

export function PostComposer({
  channels,
  defaultChannel,
  defaultDatetime,
  metaOn,
  aiOn,
}: {
  channels: [string, string][];
  defaultChannel: string;
  defaultDatetime: string;
  metaOn: boolean;
  aiOn: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [channel, setChannel] = useState(defaultChannel);
  const [format, setFormat] = useState("FEED");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiOptions, setAiOptions] = useState<CaptionOption[]>([]);

  const isMeta = META_CHANNELS.includes(channel);
  const isStory = isMeta && format === "STORY";

  const addFiles = (files: FileList | File[]) => {
    setError("");
    setSuccessMsg("");
    const limit = isStory ? 1 : MAX_ITEMS;
    const next = [...picked];
    for (const file of Array.from(files)) {
      if (next.length >= limit) {
        setError(isStory ? "A story takes exactly one photo or video." : `Instagram allows up to ${MAX_ITEMS} items per post — extra files were skipped.`);
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

  async function generateCaptions() {
    setAiBusy(true);
    setAiError("");
    setAiOptions([]);
    const form = formRef.current ? new FormData(formRef.current) : null;
    const brief = [form?.get("title"), form?.get("notes")].map((v) => String(v ?? "").trim()).filter(Boolean).join("\n");
    const image = picked.length ? await downscaleForAi(picked[0].file) : undefined;
    const r = (await postJson("/api/captions", { brief, image })) as
      | { ok: true; options: CaptionOption[] }
      | { ok: false; error?: string };
    setAiBusy(false);
    if (!r.ok) {
      setAiError(r.error || "Caption generation failed.");
      return;
    }
    setAiOptions(r.options);
  }

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
    if (isStory && picked.length !== 1) {
      setError("A story takes exactly one photo or video — attach exactly one file.");
      return;
    }

    setBusy(true);
    setPhase("Saving post…");
    const created = await postJson("/api/posts", {
      title: val("title"),
      datetime: val("datetime"),
      channel,
      format: isStory ? "STORY" : "FEED",
      status: val("status"),
      caption: isStory ? "" : caption.trim(),
      hashtags: isStory ? "" : hashtags.trim(),
      firstComment: isStory ? "" : val("firstComment"),
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

    let failed = 0;
    for (let i = 0; i < picked.length; i++) {
      setPhase(`Uploading ${i + 1} of ${picked.length}…`);
      setItem(i, { state: "uploading", progress: 0 });
      const r = await uploadFileToPost(created.id, picked[i].file, (f) => setItem(i, { progress: f }));
      if (r.ok) setItem(i, { state: "done", progress: 1 });
      else {
        failed++;
        setItem(i, { state: "error", error: r.error });
      }
    }

    setBusy(false);
    setPhase("");
    if (failed === 0) {
      picked.forEach((p) => URL.revokeObjectURL(p.url));
      setPicked([]);
      setCaption("");
      setHashtags("");
      setAiOptions([]);
      (e.target as HTMLFormElement).reset?.();
      setSuccessMsg(picked.length > 0 ? `Post saved with ${picked.length} file${picked.length === 1 ? "" : "s"} — it's on the calendar.` : "Post saved — it's on the calendar.");
      router.refresh();
    } else {
      setError(`The post was saved, but ${failed} file${failed === 1 ? "" : "s"} failed to upload — see below. You can add media from the post's card once the issue is fixed.`);
      router.refresh();
    }
  }

  const previewCaption = [caption.trim(), hashtags.trim()].filter(Boolean).join(" ");

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-3">
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
          <select name="channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls}>
            {channels.map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {isMeta && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate">Format</span>
            <select value={format} onChange={(e) => { setFormat(e.target.value); if (e.target.value === "STORY" && picked.length > 1) { picked.slice(1).forEach((p) => URL.revokeObjectURL(p.url)); setPicked(picked.slice(0, 1)); } }} className={inputCls}>
              <option value="FEED">Feed post</option>
              <option value="STORY">Story (24h)</option>
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate">Status</span>
          <select name="status" defaultValue="SCHEDULED" className={inputCls}>
            <option value="IDEA">Idea</option>
            <option value="DRAFTED">Drafted</option>
            <option value="SCHEDULED">Scheduled</option>
          </select>
        </label>
      </div>
      {isStory && (
        <p className="-mt-1 text-xs text-slate/70">
          Stories take exactly one photo or video and disappear after 24h. Captions don&apos;t apply on
          Instagram stories; Facebook stories are photo-only.
        </p>
      )}

      {/* media picker */}
      <div>
        <span className="mb-1 block text-xs font-medium text-slate">
          {isStory ? "Photo / video (exactly 1)" : `Photos / videos (up to ${MAX_ITEMS})`}
        </span>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          onClick={() => fileInput.current?.click()}
          className={`cursor-pointer rounded-md border-2 border-dashed px-3 py-4 text-center text-sm transition-colors ${
            dragOver ? "border-agave bg-agave/5 text-agave-deep" : "border-ink/15 bg-white/50 text-slate/70 hover:border-agave/50"
          }`}
        >
          <span className="font-medium text-agave-deep">Tap to add</span> or drag files here
          {!isStory && " — 2+ makes a swipe carousel, first is the cover"}
          <input
            ref={fileInput}
            type="file"
            multiple={!isStory}
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
                      {i === 0 && !isStory ? "cover · " : ""}{(p.file.size / 1024 / 1024).toFixed(1)} MB
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

      {!isStory && (
        <>
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-xs font-medium text-slate">
              <span>Caption</span>
              {aiOn && (
                <button
                  type="button"
                  onClick={generateCaptions}
                  disabled={aiBusy}
                  className="font-medium text-agave-deep hover:underline disabled:opacity-60"
                >
                  {aiBusy ? "Writing…" : "✨ Write with AI"}
                </button>
              )}
            </span>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} placeholder="Full caption in the De Nada voice — or let the AI draft it" className={inputCls} />
          </label>
          {aiError && <div className="rounded-md bg-burnt/10 px-3 py-2 text-xs text-burnt">{aiError}</div>}
          {aiOptions.length > 0 && (
            <div className="space-y-1.5">
              {aiOptions.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setCaption(o.caption); setHashtags(o.hashtags); setAiOptions([]); }}
                  className="block w-full rounded-md border border-agave/25 bg-agave/5 px-3 py-2 text-left text-xs leading-relaxed hover:border-agave/60"
                >
                  <span className="whitespace-pre-wrap">{o.caption}</span>
                  <span className="mt-1 block text-agave-deep">{o.hashtags}</span>
                </button>
              ))}
              <p className="text-[10px] text-slate/60">Tap an option to use it — then edit freely.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate">Hashtags</span>
              <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#DeNada #tequila" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate">First comment (optional)</span>
              <input name="firstComment" placeholder="Extra hashtags, posted as a comment" className={inputCls} />
            </label>
          </div>
        </>
      )}

      {/* live preview */}
      {(picked.length > 0 || previewCaption) && (
        <div>
          <span className="mb-1 block text-xs font-medium text-slate">Preview</span>
          {isStory ? (
            <div className="mx-auto w-40 overflow-hidden rounded-xl border border-ink/15 bg-ink" style={{ aspectRatio: "9/16" }}>
              {picked[0] ? (
                picked[0].file.type.startsWith("video/") ? (
                  <video src={picked[0].url} className="h-full w-full object-cover" muted />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={picked[0].url} alt="" className="h-full w-full object-cover" />
                )
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-cream/50">story media</div>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-64 overflow-hidden rounded-lg border border-ink/15 bg-white">
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-agave text-[9px] font-bold text-cream">DN</span>
                <span className="text-xs font-semibold">denadatequila</span>
              </div>
              <div className="relative aspect-square bg-cream-deep">
                {picked[0] ? (
                  picked[0].file.type.startsWith("video/") ? (
                    <video src={picked[0].url} className="h-full w-full object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={picked[0].url} alt="" className="h-full w-full object-cover" />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate/50">media</div>
                )}
                {picked.length > 1 && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-ink/70 px-1.5 py-0.5 text-[9px] text-white">1/{picked.length}</span>
                )}
              </div>
              {picked.length > 1 && (
                <div className="flex justify-center gap-1 pt-1.5">
                  {picked.map((_, i) => (
                    <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === 0 ? "bg-agave" : "bg-ink/20"}`} />
                  ))}
                </div>
              )}
              {previewCaption && (
                <p className="px-2.5 py-1.5 text-[11px] leading-snug">
                  <span className="font-semibold">denadatequila</span>{" "}
                  {previewCaption.length > 125 ? (
                    <>
                      {previewCaption.slice(0, 125)}
                      <span className="text-slate/50">… more</span>
                    </>
                  ) : (
                    previewCaption
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate">External asset link (optional)</span>
          <input name="assetUrl" placeholder="https://…" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate">Art-direction notes</span>
          <input name="notes" className={inputCls} />
        </label>
      </div>

      {metaOn && isMeta && (
        <label className="flex items-center gap-2 text-sm text-ink/85">
          <input type="checkbox" name="autoPublish" defaultChecked className="h-4 w-4 accent-agave" />
          Auto-post at the scheduled time
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
