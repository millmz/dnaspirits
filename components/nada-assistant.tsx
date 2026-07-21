"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/upload-client";
import { NadaOrb, type OrbLevel } from "@/components/nada-orb";

type Turn = { role: "user" | "assistant"; content: string };
type Mood = "idle" | "listening" | "thinking" | "speaking";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { [i: number]: { isFinal: boolean } & ArrayLike<{ transcript: string }> } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};

function getRecognizer(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = "en-US";
  r.interimResults = true;
  // keep the mic open across natural pauses; we commit on our own silence timer
  r.continuous = true;
  return r;
}

/** Strip anything that reads badly aloud and end on a sentence boundary. */
function speakable(text: string): string {
  let t = text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{FE0F}]/gu, "")
    .replace(/[*_#`~>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > 1400) {
    const cut = t.slice(0, 1400);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    t = stop > 600 ? cut.slice(0, stop + 1) : cut;
  }
  return t;
}

/** Terminal-style typeout for Nada's replies; renders instantly when animate is off. */
function TypedText({ text, animate, onTick }: { text: string; animate: boolean; onTick?: () => void }) {
  const [n, setN] = useState(animate ? 0 : text.length);
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  useEffect(() => {
    if (!animate) {
      setN(text.length);
      return;
    }
    setN(0);
    // long answers land in ~3s instead of scrolling forever
    const step = Math.max(1, Math.round(text.length / 180));
    const id = setInterval(() => {
      setN((v) => {
        const next = v + step;
        if (next >= text.length) {
          clearInterval(id);
          return text.length;
        }
        tickRef.current?.();
        return next;
      });
    }, 16);
    return () => clearInterval(id);
  }, [text, animate]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="nada-caret">▍</span>}
    </>
  );
}

/**
 * Nada's stage: her own page. A large levitating orb you talk to, with the
 * conversation flowing beneath. Sessions live server-side, so the thread
 * survives reloads, device switches, and restarts.
 */
export function NadaStage({ elevenOn = false }: { elevenOn?: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [mood, setMood] = useState<Mood>("idle");
  const [voiceOn, setVoiceOn] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [error, setError] = useState("");
  const [orbSize, setOrbSize] = useState(320);
  const hydratedCount = useRef(0); // turns loaded from the server render instantly; only new replies type out
  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const moodRef = useRef<Mood>("idle");
  moodRef.current = mood;
  const voiceRef = useRef(false);
  voiceRef.current = voiceOn;
  const lastInputWasVoice = useRef(false);
  const resumeDismissed = useRef(false);

  // live audio amplitude driving the orb — from her voice while speaking,
  // from the mic while listening; the orb self-animates when neither is live
  const levelRef = useRef<OrbLevel>({ value: 0, live: false });
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterStop = useRef<(() => void) | null>(null);

  const audioContext = (): AudioContext | null => {
    if (!audioCtxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioCtxRef.current = new Ctor();
    }
    audioCtxRef.current.resume().catch(() => undefined);
    return audioCtxRef.current;
  };

  const startMeter = (analyser: AnalyserNode, cleanup?: () => void) => {
    meterStop.current?.();
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    levelRef.current.live = true;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.min(1, Math.sqrt(sum / data.length) * 3.2);
      levelRef.current.value = levelRef.current.value * 0.6 + rms * 0.4;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    document.documentElement.dataset.nadaLive = "1"; // observable for tests/devtools
    meterStop.current = () => {
      cancelAnimationFrame(raf);
      levelRef.current.value = 0;
      levelRef.current.live = false;
      delete document.documentElement.dataset.nadaLive;
      cleanup?.();
      meterStop.current = null;
    };
  };

  useEffect(() => {
    setMicSupported(!!getRecognizer());
    setVoiceOn(localStorage.getItem("nada-voice") === "on");
    fetch("/api/ask", { headers: { "x-denada": "1" } })
      .then((r) => r.json())
      .then((r) => {
        // never overwrite a conversation the user has already reset or started
        if (r.ok && r.session && !resumeDismissed.current && moodRef.current === "idle") {
          setSessionId((cur) => cur ?? r.session.id);
          setTurns((cur) => {
            if (cur.length > 0) return cur;
            hydratedCount.current = r.session.turns.length;
            return r.session.turns;
          });
        }
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
    const sizeOrb = () =>
      setOrbSize(Math.max(220, Math.min(400, Math.floor(Math.min(window.innerWidth * 0.55, window.innerHeight * 0.42)))));
    sizeOrb();
    window.addEventListener("resize", sizeOrb);
    return () => {
      window.removeEventListener("resize", sizeOrb);
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
      meterStop.current?.();
      audioCtxRef.current?.close().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, mood]);

  /** After she finishes a spoken reply to a spoken question, reopen the mic. */
  const resumeListening = () => {
    if (!lastInputWasVoice.current || !voiceRef.current) return;
    if (document.visibilityState !== "visible") return;
    setTimeout(() => {
      if (moodRef.current === "idle") listen();
    }, 450);
  };

  const browserSpeak = (text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const say = () => {
      const u = new SpeechSynthesisUtterance(text);
      const voices = synth.getVoices();
      u.voice =
        voices.find((v) => v.lang.startsWith("en") && /Samantha|Google US|Natural/i.test(v.name)) ??
        voices.find((v) => v.lang.startsWith("en")) ??
        null;
      u.rate = 1.02;
      u.onstart = () => setMood("speaking");
      u.onend = () => {
        clearInterval(keepAlive);
        setMood("idle");
        resumeListening();
      };
      u.onerror = () => {
        clearInterval(keepAlive);
        setMood("idle");
      };
      // Chrome stalls long utterances after ~15s unless nudged
      const keepAlive = setInterval(() => {
        if (!synth.speaking) return clearInterval(keepAlive);
        synth.pause();
        synth.resume();
      }, 10_000);
      synth.speak(u);
    };
    if (synth.getVoices().length > 0) return say();
    // voices load async on first use — wait once, with a fallback timer
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      synth.onvoiceschanged = null;
      say();
    };
    synth.onvoiceschanged = go;
    setTimeout(go, 700);
  };

  const speak = async (text: string) => {
    if (!voiceOn) return;
    const say = speakable(text);
    if (!say) return;
    audioRef.current?.pause();
    meterStop.current?.();
    if (elevenOn) {
      // her real voice — ElevenLabs via the server; browser voice is the net
      try {
        const res = await fetch("/api/ask/speak", {
          method: "POST",
          headers: { "content-type": "application/json", "x-denada": "1" },
          body: JSON.stringify({ text: say }),
        });
        if (res.ok && res.headers.get("content-type")?.includes("audio")) {
          const url = URL.createObjectURL(await res.blob());
          const audio = new Audio(url);
          audio.preload = "auto";
          audioRef.current = audio;
          audio.onplay = () => setMood("speaking");
          audio.onended = () => {
            setMood("idle");
            meterStop.current?.();
            URL.revokeObjectURL(url);
            resumeListening();
          };
          audio.onerror = () => {
            setMood("idle");
            meterStop.current?.();
            URL.revokeObjectURL(url);
          };
          try {
            // route her voice through an analyser so the orb rides the waveform
            const actx = audioContext();
            if (actx) {
              await actx.resume().catch(() => undefined);
              const src = actx.createMediaElementSource(audio);
              const analyser = actx.createAnalyser();
              analyser.fftSize = 512;
              src.connect(analyser);
              analyser.connect(actx.destination);
              // disconnect on stop so nodes don't pile up across replies
              startMeter(analyser, () => {
                try {
                  src.disconnect();
                  analyser.disconnect();
                } catch {
                  // already gone
                }
              });
            }
          } catch {
            // metering is a nicety — playback continues without it
          }
          try {
            await audio.play();
            return;
          } catch {
            // autoplay blocked (common on phones) — release and use the browser voice
            meterStop.current?.();
          }
        }
        // the server said no — say why instead of silently sounding different
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        if (j?.error) setError(`Her voice is temporarily unavailable (${j.error}) — using the standard voice for now.`);
      } catch {
        // fall through to the browser voice
      }
    }
    browserSpeak(say);
  };

  async function send(text: string) {
    const question = text.trim();
    if (!question || moodRef.current === "thinking") return;
    setError("");
    setInput("");
    setTurns((t) => [...t, { role: "user", content: question }]);
    setMood("thinking");
    const r = (await postJson("/api/ask", { question, sessionId })) as { ok: boolean; answer?: string; sessionId?: string; error?: string };
    if (r.ok && r.answer) {
      if (r.sessionId) setSessionId(r.sessionId);
      setTurns((t) => [...t, { role: "assistant", content: r.answer! }]);
      setMood("idle");
      speak(r.answer);
    } else {
      setMood("idle");
      setError(r.error || "Nada couldn't answer that one — try again.");
    }
  }

  const listen = () => {
    if (moodRef.current === "listening") {
      recognizer.current?.stop();
      return;
    }
    const r = getRecognizer();
    if (!r) return;
    // barge-in: tapping the core while she talks interrupts her and hands you the mic
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    meterStop.current?.();
    recognizer.current = r;
    let finalText = "";
    let silence: ReturnType<typeof setTimeout> | undefined;
    const armSilence = (ms: number) => {
      clearTimeout(silence);
      silence = setTimeout(() => r.stop(), ms);
    };
    r.onresult = (e) => {
      let all = "";
      let finals = "";
      for (let i = 0; i < e.results.length; i++) {
        const seg = e.results[i][0].transcript;
        all += seg;
        if (e.results[i].isFinal) finals += seg;
      }
      setInput(all.trimStart());
      finalText = (finals || all).trim();
      // the mic stays open through natural pauses; a real stop in speech commits
      armSilence(finalText ? 1700 : 2600);
    };
    r.onend = () => {
      clearTimeout(silence);
      setMood("idle");
      meterStop.current?.();
      if (finalText.trim()) {
        lastInputWasVoice.current = true;
        send(finalText);
      }
    };
    r.onerror = (e) => {
      clearTimeout(silence);
      setMood("idle");
      meterStop.current?.();
      const code = e?.error ?? "";
      if (code === "no-speech" || code === "aborted") return; // tapped without talking — not an error
      if (code === "not-allowed" || code === "service-not-allowed") {
        setError(
          "The browser is blocking the mic. Click the icon by the address bar, allow the microphone for this site, then tap Nada again."
        );
      } else if (code === "network") {
        setError("Speech recognition needs a moment — check your connection and try again.");
      } else {
        setError("Couldn't hear you — check the mic permission and try again.");
      }
    };
    setError("");
    setMood("listening");
    r.start();
    armSilence(8000); // said nothing at all — close the mic quietly
    // meter the mic so the orb reacts to the user's voice while she listens
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => {
        if (moodRef.current !== "listening") {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        const actx = audioContext();
        if (!actx) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        const src = actx.createMediaStreamSource(stream);
        const analyser = actx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser); // never to destination — no feedback loop
        startMeter(analyser, () => stream.getTracks().forEach((tr) => tr.stop()));
      })
      .catch(() => undefined);
  };

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    localStorage.setItem("nada-voice", next ? "on" : "off");
    if (!next) window.speechSynthesis?.cancel();
  };

  const newChat = () => {
    resumeDismissed.current = true; // a late resume fetch must not repopulate the old thread
    // silence everything from the old conversation
    recognizer.current?.stop();
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    meterStop.current?.();
    lastInputWasVoice.current = false;
    // close every open thread server-side so a reload can't resurrect any of them
    fetch("/api/ask", { method: "DELETE", headers: { "x-denada": "1" } }).catch(() => undefined);
    setSessionId(undefined);
    hydratedCount.current = 0;
    setTurns([]);
    setInput("");
    setError("");
    setMood("idle");
  };

  type CheckRow = { label: string; ok: boolean | null; note: string };
  const [check, setCheck] = useState<CheckRow[] | null>(null);
  const [checking, setChecking] = useState(false);

  /** One tap answers "why isn't the voice/mic working?" with specifics. */
  const runCheck = async () => {
    setChecking(true);
    const rows: CheckRow[] = [];

    const fp = (document as unknown as { featurePolicy?: { allowsFeature: (f: string) => boolean } }).featurePolicy;
    const micAllowed = fp ? fp.allowsFeature("microphone") : undefined;
    if (micAllowed === true) rows.push({ label: "Site allows the microphone", ok: true, note: "the latest update is deployed" });
    else if (micAllowed === false)
      rows.push({ label: "Site policy is blocking the microphone", ok: false, note: "the newest deploy hasn't landed — check Render → denada-ops → Events, then hard-refresh this page" });
    else rows.push({ label: "Microphone site policy", ok: null, note: "this browser doesn't expose it — try the orb and see" });

    rows.push(
      getRecognizer()
        ? { label: "Speech recognition is supported here", ok: true, note: "tap-to-talk is available" }
        : { label: "Speech recognition isn't supported in this browser", ok: false, note: "use Chrome, Edge, or Safari — typing always works" }
    );

    try {
      const st = (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
      if (st === "granted") rows.push({ label: "Mic permission granted", ok: true, note: "you're set" });
      else if (st === "denied")
        rows.push({ label: "Mic permission is blocked in your browser", ok: false, note: "click the icon at the left of the address bar → set Microphone to Allow → refresh" });
      else rows.push({ label: "Mic permission not asked yet", ok: null, note: "tap the orb and choose Allow when prompted" });
    } catch {
      rows.push({ label: "Mic permission", ok: null, note: "couldn't query it in this browser" });
    }

    try {
      const r = (await (await fetch("/api/ask/speak", { headers: { "x-denada": "1" } })).json()) as {
        configured?: boolean; working?: boolean; voice?: string; model?: string; hint?: string;
      };
      if (!r.configured) rows.push({ label: "ElevenLabs isn't configured on the server", ok: false, note: r.hint ?? "" });
      else if (r.working) rows.push({ label: "Her ElevenLabs voice works end-to-end", ok: true, note: `voice ${r.voice} · ${r.model}` });
      else rows.push({ label: "ElevenLabs is configured but failing", ok: false, note: r.hint ?? "" });
    } catch {
      rows.push({ label: "Voice service check", ok: false, note: "couldn't reach the server — are you online?" });
    }

    if (!voiceOn) rows.push({ label: "Voice replies are switched off", ok: null, note: "flip 🔊 on above to hear her" });

    setCheck(rows);
    setChecking(false);
  };

  const scrollLog = () => scroller.current?.scrollTo({ top: scroller.current.scrollHeight });

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-ink">
      <div className="nada-stage-bg pointer-events-none absolute inset-0" aria-hidden />
      <div className="nada-hud-frame pointer-events-none absolute inset-3 sm:inset-4" aria-hidden />
      <div className="nada-hud-frame nada-hud-frame-alt pointer-events-none absolute inset-3 sm:inset-4" aria-hidden />

      {/* quiet console controls */}
      <div className="relative z-10 flex items-center gap-4 px-5 pt-4 font-mono text-[11px] lowercase tracking-wide sm:px-7 sm:pt-5">
        <Link href="/" className="text-cream/40 hover:text-cream" title="Back to the ops dashboard">
          [ ← ops ]
        </Link>
        <span className="hidden text-cream/25 sm:inline">de nada · operations intelligence</span>
        <span className="flex-1" />
        <button onClick={toggleVoice} className={voiceOn ? "text-agave hover:text-cream" : "text-cream/40 hover:text-cream"}>
          [ voice replies {voiceOn ? "on" : "off"} ]
        </button>
        <button onClick={newChat} className="text-cream/40 hover:text-cream" title="Start a fresh conversation">
          [ + new conversation ]
        </button>
        <button
          onClick={check ? () => setCheck(null) : runCheck}
          disabled={checking}
          className="text-cream/40 hover:text-cream disabled:opacity-50"
          title="Check the voice and microphone setup"
        >
          [ {checking ? "checking…" : check ? "hide check" : "system check"} ]
        </button>
      </div>

      {check && (
        <div className="relative z-10 mx-auto mt-2 w-full max-w-2xl space-y-1.5 rounded-md border border-cream/15 bg-ink/80 px-4 py-3 font-mono">
          {check.map((row, i) => (
            <div key={i} className="flex items-start gap-2 text-xs leading-relaxed">
              <span className={row.ok === true ? "text-agave" : row.ok === false ? "text-red-300" : "text-cream/40"}>
                {row.ok === true ? "✓" : row.ok === false ? "✗" : "○"}
              </span>
              <span>
                <span className="text-cream">{row.label}</span>
                {row.note && <span className="text-cream/50"> — {row.note}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* her — the center of the room */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center py-2">
        <button
          onClick={micSupported ? listen : undefined}
          aria-label={micSupported ? (mood === "listening" ? "Stop listening" : "Talk to Nada") : "Nada"}
          className={`nada-float relative rounded-full ${micSupported ? "cursor-pointer transition-transform hover:scale-[1.02] active:scale-95" : "cursor-default"}`}
          title={micSupported ? "Tap to talk" : undefined}
        >
          <NadaOrb mood={mood} size={orbSize} level={levelRef} />
        </button>
        <div className="nada-shadow -mt-4 h-3 w-40 rounded-[50%] bg-ink shadow-[0_0_32px_14px_rgba(1,135,105,0.3)]" />
        <div className="relative mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-cream/55">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              mood === "listening"
                ? "animate-pulse bg-blanco"
                : mood === "thinking"
                  ? "animate-pulse bg-reposado"
                  : mood === "speaking"
                    ? "animate-pulse bg-cream"
                    : "bg-agave"
            }`}
          />
          {mood === "listening"
            ? "listening — pause when you're done"
            : mood === "thinking"
              ? "processing"
              : mood === "speaking"
                ? "speaking"
                : micSupported
                  ? "nada · online — tap the core to talk"
                  : "nada · online — type below"}
        </div>
      </div>

      {/* the console: her words, secondary to her presence */}
      <div ref={scroller} className="nada-log relative z-10 mx-auto max-h-[30vh] w-full max-w-3xl space-y-2 overflow-y-auto px-6 font-mono text-[13px] leading-relaxed">
        {hydrated && turns.length === 0 && (
          <div className="whitespace-pre-wrap">
            <span className="mr-2 text-agave">nada ❯</span>
            <span className="text-cream/70">
              online. i know the live numbers — depletions, invoices, stock, what to post next. teach me things: just say &ldquo;remember this.&rdquo;
            </span>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="whitespace-pre-wrap">
              <span className="mr-2 text-blanco/80">you&nbsp;&nbsp;❯</span>
              <span className="text-cream/60">{t.content}</span>
            </div>
          ) : (
            <div key={i} className="whitespace-pre-wrap">
              <span className="mr-2 text-agave">nada ❯</span>
              <span className="text-cream/90">
                <TypedText text={t.content} animate={i >= hydratedCount.current} onTick={scrollLog} />
              </span>
            </div>
          )
        )}
        {mood === "thinking" && (
          <div>
            <span className="mr-2 text-agave">nada ❯</span>
            <span className="text-cream/50">
              <span className="nada-caret">▍</span>
            </span>
          </div>
        )}
        {error && (
          <div>
            <span className="mr-2 text-red-300">sys&nbsp;&nbsp;✗</span>
            <span className="text-red-300/90">{error}</span>
          </div>
        )}
      </div>

      {/* command line */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lastInputWasVoice.current = false;
          send(input);
        }}
        className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-5 pt-3"
      >
        <div className="flex items-center gap-3 border-t border-cream/10 pt-3 font-mono">
          {micSupported && (
            <button
              type="button"
              onClick={listen}
              aria-label={mood === "listening" ? "Stop listening" : "Talk to Nada"}
              className={`shrink-0 transition-colors ${mood === "listening" ? "animate-pulse text-burnt" : "text-cream/40 hover:text-agave"}`}
              title="Talk instead of typing"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
                <path d="M19 11a7 7 0 0 1-14 0H3a9 9 0 0 0 8 8.94V23h2v-3.06A9 9 0 0 0 21 11h-2z" />
              </svg>
            </button>
          )}
          <span className="shrink-0 text-agave">❯</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mood === "listening" ? "listening…" : "ask nada anything"}
            className="w-full border-none bg-transparent text-base text-cream caret-agave placeholder:text-cream/30 focus:outline-none sm:text-sm"
          />
          <button
            type="submit"
            disabled={mood === "thinking"}
            className="shrink-0 text-xs lowercase text-cream/40 hover:text-agave disabled:opacity-40"
          >
            [ send ⏎ ]
          </button>
        </div>
      </form>
    </div>
  );
}
