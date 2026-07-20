"use client";

import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/upload-client";

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
  onerror: (() => void) | null;
};

function getRecognizer(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = "en-US";
  r.interimResults = true;
  r.continuous = false;
  return r;
}

export function AgaveAvatar({ mood, size = 132 }: { mood: Mood; size?: number }) {
  const leaves = [-72, -54, -36, -18, 0, 18, 36, 54, 72];
  const fill = (i: number) => ["#016B54", "#018769", "#2FA183", "#57B89B"][Math.min(3, 3 - Math.abs(i - 4) + 1)] ?? "#018769";
  return (
    <div className={`nada-${mood} relative shrink-0`} aria-label={`Nada is ${mood}`}>
      <svg width={size} height={size} viewBox="0 0 200 200">
        <defs>
          <radialGradient id="nadaGlow" cx="50%" cy="55%" r="50%">
            <stop offset="0%" stopColor="#018769" stopOpacity="0.85" />
            <stop offset="60%" stopColor="#018769" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#018769" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="96" fill="#231F20" />
        <circle cx="100" cy="100" r="96" fill="none" stroke="#018769" strokeOpacity="0.35" strokeWidth="2" />
        <circle className="nada-glow" cx="100" cy="100" r="78" fill="url(#nadaGlow)" />
        {mood === "listening" && (
          <>
            <circle className="nada-ring" cx="100" cy="100" r="84" fill="none" stroke="#57B89B" strokeWidth="2" />
            <circle className="nada-ring nada-ring2" cx="100" cy="100" r="84" fill="none" stroke="#57B89B" strokeWidth="2" />
          </>
        )}
        {leaves.map((angle, i) => (
          <path
            key={angle}
            className="agave-leaf"
            style={{ ["--r" as string]: `${angle}deg`, ["--d" as string]: `${i * 0.12}s` } as React.CSSProperties}
            d="M100 148 C 91 112, 93 72, 100 38 C 107 72, 109 112, 100 148 Z"
            fill={fill(i)}
            stroke="#F3F8E4"
            strokeOpacity="0.18"
            strokeWidth="1"
          />
        ))}
        <circle cx="100" cy="140" r="7" fill="#F3F8E4" opacity="0.9" />
      </svg>
    </div>
  );
}

/**
 * Nada's stage: her own page. A large levitating orb you talk to, with the
 * conversation flowing beneath. Sessions live server-side, so the thread
 * survives reloads, device switches, and restarts.
 */
export function NadaStage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [mood, setMood] = useState<Mood>("idle");
  const [voiceOn, setVoiceOn] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [error, setError] = useState("");
  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const moodRef = useRef<Mood>("idle");
  moodRef.current = mood;

  useEffect(() => {
    setMicSupported(!!getRecognizer());
    setVoiceOn(localStorage.getItem("nada-voice") === "on");
    fetch("/api/ask", { headers: { "x-denada": "1" } })
      .then((r) => r.json())
      .then((r) => {
        if (r.ok && r.session) {
          setSessionId(r.session.id);
          setTurns(r.session.turns);
        }
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
    return () => window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, mood]);

  const speak = (text: string) => {
    if (!voiceOn || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.lang.startsWith("en") && /Samantha|Google US|Natural/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
    u.rate = 1.02;
    u.onstart = () => setMood("speaking");
    u.onend = () => setMood("idle");
    window.speechSynthesis.speak(u);
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
    if (mood === "listening") {
      recognizer.current?.stop();
      return;
    }
    const r = getRecognizer();
    if (!r) return;
    recognizer.current = r;
    let finalText = "";
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      setInput(text);
      if (e.results[e.results.length - 1]?.isFinal) finalText = text;
    };
    r.onend = () => {
      setMood("idle");
      if (finalText.trim()) send(finalText);
    };
    r.onerror = () => {
      setMood("idle");
      setError("Couldn't hear you — check the mic permission and try again.");
    };
    setMood("listening");
    r.start();
  };

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    localStorage.setItem("nada-voice", next ? "on" : "off");
    if (!next) window.speechSynthesis?.cancel();
  };

  const newChat = () => {
    setSessionId(undefined);
    setTurns([]);
    setError("");
  };

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-xl border border-agave/25 bg-ink shadow-xl">
      {/* top controls */}
      <div className="flex items-center justify-end gap-2 px-4 pt-3">
        <button
          onClick={toggleVoice}
          className={`rounded-full border px-3 py-1 text-xs ${voiceOn ? "border-agave bg-agave/20 text-cream" : "border-cream/20 text-cream/50 hover:text-cream"}`}
        >
          {voiceOn ? "🔊 voice replies on" : "🔇 voice replies off"}
        </button>
        <button onClick={newChat} className="rounded-full border border-cream/20 px-3 py-1 text-xs text-cream/50 hover:text-cream" title="Start a fresh conversation">
          + new conversation
        </button>
      </div>

      {/* the orb */}
      <div className="flex flex-col items-center pt-2">
        <button
          onClick={micSupported ? listen : undefined}
          aria-label={micSupported ? (mood === "listening" ? "Stop listening" : "Talk to Nada") : "Nada"}
          className={`nada-float rounded-full ${micSupported ? "cursor-pointer transition-transform hover:scale-[1.03] active:scale-95" : "cursor-default"}`}
          title={micSupported ? "Tap to talk" : undefined}
        >
          <AgaveAvatar mood={mood} size={210} />
        </button>
        <div className="nada-shadow -mt-2 h-3 w-32 rounded-[50%] bg-ink shadow-[0_0_24px_10px_rgba(1,135,105,0.25)]" />
        <div className="brand-heading mt-3 text-lg tracking-[0.3em] text-cream">NADA</div>
        <div className="mt-0.5 text-xs text-cream/50">
          {mood === "listening" ? "listening — speak now" : mood === "thinking" ? "checking the numbers…" : mood === "speaking" ? "speaking" : micSupported ? "tap the orb to talk, or type below" : "type below"}
        </div>
      </div>

      {/* conversation */}
      <div ref={scroller} className="mx-auto mt-4 w-full max-w-2xl flex-1 space-y-2 overflow-y-auto px-4 pb-2">
        {hydrated && turns.length === 0 && (
          <div className="rounded-md bg-white/5 px-4 py-3 text-sm leading-relaxed text-cream/80">
            Ask me anything about the business — depletions, invoices, stock, what to post next.
            I remember our conversations, and you can teach me things: just say &ldquo;remember this.&rdquo;
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed ${t.role === "user" ? "bg-agave text-cream" : "bg-cream text-ink"}`}>
              {t.content}
            </div>
          </div>
        ))}
        {mood === "thinking" && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-cream/90 px-3 py-2 text-sm text-slate">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">·</span>
                <span className="animate-bounce [animation-delay:0.15s]">·</span>
                <span className="animate-bounce [animation-delay:0.3s]">·</span>
              </span>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-300">{error}</p>}
      </div>

      {/* input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 pb-4 pt-2"
      >
        {micSupported && (
          <button
            type="button"
            onClick={listen}
            aria-label={mood === "listening" ? "Stop listening" : "Talk to Nada"}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors ${mood === "listening" ? "bg-burnt text-cream" : "bg-agave text-cream hover:bg-agave-deep"}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
              <path d="M19 11a7 7 0 0 1-14 0H3a9 9 0 0 0 8 8.94V23h2v-3.06A9 9 0 0 0 21 11h-2z" />
            </svg>
          </button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={mood === "listening" ? "Listening…" : "Ask Nada anything…"}
          className="w-full rounded-md border border-cream/20 bg-white/10 px-3 py-2.5 text-base text-cream placeholder-cream/40 focus:border-agave focus:outline-none focus:ring-1 focus:ring-agave sm:text-sm"
        />
        <button
          type="submit"
          disabled={mood === "thinking"}
          className="brand-heading shrink-0 rounded-md bg-agave px-5 py-2.5 text-sm font-medium text-cream hover:bg-agave-deep disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
