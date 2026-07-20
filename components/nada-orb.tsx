"use client";

import { useEffect, useRef } from "react";

type Mood = "idle" | "listening" | "thinking" | "speaking";

/** Live audio amplitude fed to the orb. `live` means a real analyser is driving it. */
export type OrbLevel = { value: number; live: boolean };

/* De Nada palette as rgb triplets for canvas compositing */
const AGAVE = "1,135,105";
const BLANCO = "106,173,156";
const CREAM = "243,248,228";
const REPOSADO = "211,114,64";

const LEAVES = 9;

type Particle = {
  leaf: number; // -1 = free orbiter, 0..8 = flows along that leaf streak
  r0: number; // free: base orbit radius (fraction of R)
  ang: number; // free: current angle
  va: number; // free: angular velocity
  off: number; // leaf: travel offset along the streak
  spd: number; // leaf: travel speed
  size: number;
  ph: number; // flicker phase
  col: string; // rgb triplet
};

function makeParticles(n: number): Particle[] {
  const ps: Particle[] = [];
  for (let i = 0; i < n; i++) {
    const isLeaf = Math.random() < 0.6;
    const roll = Math.random();
    const col = roll < 0.55 ? AGAVE : roll < 0.8 ? BLANCO : roll < 0.93 ? CREAM : REPOSADO;
    ps.push({
      leaf: isLeaf ? Math.floor(Math.random() * LEAVES) : -1,
      r0: 0.3 + Math.random() * 0.68,
      ang: Math.random() * Math.PI * 2,
      va: (0.12 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1),
      off: Math.random(),
      spd: 0.05 + Math.random() * 0.09,
      size: 0.7 + Math.random() * 1.5,
      ph: Math.random() * Math.PI * 2,
      col,
    });
  }
  return ps;
}

/**
 * Nada's core: a canvas-rendered reactor that is never still. A rosette of
 * nine particle streaks (her agave signature) flows out of a breathing
 * energy core, wrapped in rotating instrument arcs. Mood eases the whole
 * system between states, and `level` — real audio amplitude when available —
 * makes her surge with every word spoken or heard.
 */
export function NadaOrb({ mood, size = 260, level }: { mood: Mood; size?: number; level?: React.RefObject<OrbLevel> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef<Mood>(mood);
  moodRef.current = mood;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const cx = size / 2;
    const cy = size / 2;
    const R = (size / 2) * 0.94;

    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timeScale = calm ? 0.2 : 1;

    const particles = makeParticles(520);
    const ripples: { r: number; a: number }[] = [];
    let rippleAt = 0;

    // eased system state — moods set targets, every frame drifts toward them
    let rot = 0.12; // swirl speed
    let energy = 0.3; // overall brightness
    let pull = 1; // radial scale (thinking draws everything inward)
    let rosette = 0; // rosette rotation accumulator
    let a1 = 0, a2 = 1.6, a3 = 3.1, ticksAng = 0; // instrument arc rotations
    let lvlSmooth = 0;

    let raf = 0;
    let last = performance.now();
    const t0 = last;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (now - last) / 1000) * timeScale;
      last = now;
      const t = ((now - t0) / 1000) * timeScale;
      const m = moodRef.current;

      // -- audio level: real analyser when live, a speech-like envelope otherwise
      const src = level?.current;
      let lvl = src?.live ? src.value : 0;
      if (!src?.live && m === "speaking") {
        const cadence = (Math.sin(t * 5.3) * 0.5 + 0.5) * (Math.sin(t * 13.7 + 1.1) * 0.5 + 0.5);
        lvl = 0.15 + 0.6 * cadence;
      }
      lvlSmooth += (lvl - lvlSmooth) * Math.min(1, dt * 14);

      // -- mood targets
      const tgt =
        m === "listening" ? { rot: 0.32, energy: 0.72, pull: 1.03 }
        : m === "thinking" ? { rot: 1.6, energy: 0.95, pull: 0.8 }
        : m === "speaking" ? { rot: 0.5, energy: 0.7, pull: 1 }
        : { rot: 0.14, energy: 0.48, pull: 1 };
      const ease = Math.min(1, dt * 2.2);
      rot += (tgt.rot - rot) * ease;
      energy += (tgt.energy - energy) * ease;
      pull += (tgt.pull - pull) * ease;

      const breath = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 5);
      const boost = Math.min(1.6, energy + lvlSmooth * 1.2);

      rosette += dt * rot * 0.35;
      a1 += dt * rot * 0.55;
      a2 -= dt * rot * 0.4;
      a3 += dt * rot * 1.1;
      ticksAng += dt * rot * 0.12;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.globalCompositeOperation = "lighter";

      // -- breathing halo + core
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      halo.addColorStop(0, `rgba(${AGAVE},${0.24 * boost + 0.06 * breath})`);
      halo.addColorStop(0.55, `rgba(${AGAVE},${0.08 * boost})`);
      halo.addColorStop(1, `rgba(${AGAVE},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);

      const midR = R * 0.34 * (1 + 0.14 * breath + 0.3 * lvlSmooth);
      const mid = ctx.createRadialGradient(cx, cy, 0, cx, cy, midR);
      mid.addColorStop(0, `rgba(${AGAVE},${0.5 + 0.3 * boost})`);
      mid.addColorStop(1, `rgba(${AGAVE},0)`);
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.arc(cx, cy, midR, 0, Math.PI * 2);
      ctx.fill();

      const hotR = R * 0.13 * (1 + 0.55 * lvlSmooth + 0.08 * breath);
      const hot = ctx.createRadialGradient(cx, cy, 0, cx, cy, hotR);
      hot.addColorStop(0, `rgba(${CREAM},${0.75 + 0.25 * lvlSmooth})`);
      hot.addColorStop(0.7, `rgba(${CREAM},0.18)`);
      hot.addColorStop(1, `rgba(${CREAM},0)`);
      ctx.fillStyle = hot;
      ctx.beginPath();
      ctx.arc(cx, cy, hotR, 0, Math.PI * 2);
      ctx.fill();

      // -- particles: leaf streaks (her agave signature) + free orbiters
      for (const p of particles) {
        let x: number, y: number, alpha: number, sz: number;
        if (p.leaf >= 0) {
          const u = (p.off + t * p.spd * (0.6 + boost * 0.9)) % 1;
          const leafAng = rosette + (p.leaf * Math.PI * 2) / LEAVES + Math.sin(t * 0.6 + p.leaf) * 0.06 + Math.sin(p.ph + u * 9) * 0.05 * (0.4 + u);
          const rad = (0.06 + u * 0.66) * R * pull;
          x = cx + Math.cos(leafAng) * rad;
          y = cy + Math.sin(leafAng) * rad;
          alpha = (1 - u) ** 1.4 * (0.35 + 0.65 * boost) * (0.7 + 0.3 * Math.sin(t * 2.2 + p.ph));
          sz = p.size * (1.5 - u);
        } else {
          p.ang += p.va * dt * (0.4 + rot * 2.2);
          const rad = (p.r0 + Math.sin(t * 0.7 + p.ph) * 0.02) * R * pull;
          x = cx + Math.cos(p.ang) * rad;
          y = cy + Math.sin(p.ang) * rad;
          const flicker = calm ? 0.8 : 0.5 + 0.5 * Math.sin(t * (1.5 + p.spd * 20) + p.ph);
          alpha = (0.1 + 0.5 * flicker) * (0.35 + 0.75 * boost) * (p.col === REPOSADO ? 0.8 : 1);
          sz = p.size;
        }
        if (alpha <= 0.015) continue;
        const a = Math.min(1, alpha);
        // soft bloom under each spark, then the spark itself
        ctx.fillStyle = `rgba(${p.col},${a * 0.22})`;
        ctx.beginPath();
        ctx.arc(x, y, sz * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${p.col},${a})`;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }

      // -- energy filaments: tangled organic rings around the core
      for (let f = 0; f < 3; f++) {
        const dir = f % 2 === 0 ? 1 : -1;
        const ft = t * (0.3 + f * 0.14) * dir + f * 2.1;
        ctx.strokeStyle = `rgba(${f === 2 ? BLANCO : AGAVE},${(0.1 + 0.2 * boost) * (1 - f * 0.22)})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (let s = 0; s <= 90; s++) {
          const a = (s / 90) * Math.PI * 2;
          const wob =
            Math.sin(a * 3 + ft) * 0.05 +
            Math.sin(a * 7 - ft * 1.6) * 0.03 +
            Math.sin(a * 11 + ft * 0.7) * 0.015 * (1 + lvlSmooth * 2);
          const rr = R * (0.4 + f * 0.09 + wob) * pull;
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // -- instrument arcs (the HUD): counter-rotating broken rings
      const arc = (r: number, start: number, len: number, w: number, col: string, alpha: number) => {
        ctx.strokeStyle = `rgba(${col},${alpha})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, start + len);
        ctx.stroke();
      };
      const arcA = 0.16 + 0.3 * boost;
      arc(R * 0.84, a1, 2.1, 1.2, BLANCO, arcA);
      arc(R * 0.84, a1 + Math.PI, 1.2, 1.2, BLANCO, arcA * 0.7);
      arc(R * 0.95, a2, 2.8, 1, AGAVE, arcA * 0.9);
      arc(R * 0.95, a2 + Math.PI * 1.2, 0.7, 1, CREAM, arcA * 0.6);
      arc(R * 0.52, a3, 1.5, 1.4, BLANCO, Math.min(0.6, arcA * (0.4 + rot * 0.5)));
      arc(R * 0.52, a3 + Math.PI * 0.9, 0.5, 1.4, CREAM, Math.min(0.5, arcA * (0.3 + rot * 0.4)));

      // -- tick ring: slow instrument dial
      ctx.strokeStyle = `rgba(${CREAM},${0.1 + 0.12 * boost})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 60; i++) {
        const a = ticksAng + (i * Math.PI * 2) / 60;
        const inner = R * 0.895;
        const len = i % 5 === 0 ? R * 0.035 : R * 0.016;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len));
        ctx.stroke();
      }

      // -- boundary ring
      ctx.strokeStyle = `rgba(${AGAVE},${0.2 + 0.25 * boost})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      // -- sonar ripples: while listening, and on loud speech peaks
      if (!calm && ((m === "listening" && t - rippleAt > 0.9) || (m === "speaking" && lvlSmooth > 0.55 && t - rippleAt > 0.5))) {
        ripples.push({ r: R * 0.5, a: 0.5 });
        rippleAt = t;
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        rp.r += dt * R * 0.55;
        rp.a -= dt * 0.45;
        if (rp.a <= 0 || rp.r > R * 1.02) { ripples.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(${BLANCO},${rp.a})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, rp.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, level]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="block"
      aria-label={`Nada is ${mood}`}
      role="img"
    />
  );
}
