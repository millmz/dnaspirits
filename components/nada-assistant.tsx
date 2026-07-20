"use client";

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
  r.continuous = false;
  return r;
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
  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const moodRef = useRef<Mood>("idle");
  moodRef.current = mood;

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
        if (r.ok && r.session) {
          setSessionId(r.session.id);
          setTurns(r.session.turns);
        }
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
    return () => {
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

  const browserSpeak = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.lang.startsWith("en") && /Samantha|Google US|Natural/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
    u.rate = 1.02;
    u.onstart = () => setMood("speaking");
    u.onend = () => setMood("idle");
    window.speechSynthesis.speak(u);
  };

  const speak = async (text: string) => {
    if (!voiceOn) return;
    audioRef.current?.pause();
    meterStop.current?.();
    if (elevenOn) {
      // her real voice — ElevenLabs via the server; browser voice is the net
      try {
        const res = await fetch("/api/ask/speak", {
          method: "POST",
          headers: { "content-type": "application/json", "x-denada": "1" },
          body: JSON.stringify({ text }),
        });
        if (res.ok && res.headers.get("content-type")?.includes("audio")) {
          const url = URL.createObjectURL(await res.blob());
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onplay = () => setMood("speaking");
          audio.onended = () => {
            setMood("idle");
            meterStop.current?.();
            URL.revokeObjectURL(url);
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
              const src = actx.createMediaElementSource(audio);
              const analyser = actx.createAnalyser();
              analyser.fftSize = 512;
              src.connect(analyser);
              analyser.connect(actx.destination);
              startMeter(analyser);
            }
          } catch {
            // metering is a nicety — playback continues without it
          }
          await audio.play();
          return;
        }
      } catch {
        // fall through to the browser voice
      }
    }
    browserSpeak(text);
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
      meterStop.current?.();
      if (finalText.trim()) send(finalText);
    };
    r.onerror = (e) => {
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

      {/* the stage */}
      <div className="relative flex flex-col items-center overflow-hidden pb-1 pt-3">
        <div className="nada-stage-bg pointer-events-none absolute inset-0" aria-hidden />
        <div className="nada-hud-frame pointer-events-none absolute inset-3" aria-hidden />
        <div className="nada-hud-frame nada-hud-frame-alt pointer-events-none absolute inset-3" aria-hidden />
        <button
          onClick={micSupported ? listen : undefined}
          aria-label={micSupported ? (mood === "listening" ? "Stop listening" : "Talk to Nada") : "Nada"}
          className={`nada-float relative rounded-full ${micSupported ? "cursor-pointer transition-transform hover:scale-[1.02] active:scale-95" : "cursor-default"}`}
          title={micSupported ? "Tap to talk" : undefined}
        >
          <NadaOrb mood={mood} size={280} level={levelRef} />
        </button>
        <div className="nada-shadow -mt-3 h-3 w-36 rounded-[50%] bg-ink shadow-[0_0_28px_12px_rgba(1,135,105,0.3)]" />
        <div className="brand-heading relative mt-3 text-lg tracking-[0.35em] text-cream">NADA</div>
        <div className="relative mt-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-cream/55">
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
            ? "listening — speak now"
            : mood === "thinking"
              ? "processing"
              : mood === "speaking"
                ? "speaking"
                : micSupported
                  ? "online — tap the core to talk"
                  : "online — type below"}
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
