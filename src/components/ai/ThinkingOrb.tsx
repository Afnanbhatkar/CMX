"use client";

/**
 * CodeMind X V2 — ThinkingOrb (AI activity reference component, Phase 8B).
 *
 * Two rendering paths behind ONE component:
 *
 * - Classic states ("idle" | "thinking" | "done"): the original layered
 *   radial orb with a rotating conic highlight ring (framer-motion).
 *
 * - "solving" (Phase 8B): native canvas reconstruction of the user-supplied
 *   Thinking Orb reference — `createThinkingOrb(target, { state: "solving",
 *   size: 64, theme: "dark", variant: "classic", speed: 1, interactive:
 *   false, ariaLabel: "Solving" })` — rendered as the reference's 74px pill
 *   holding a 56px visible orb (64px canvas, orb drawn at 56px), with the
 *   label inside the pill. The canvas logic is FULLY self-contained in this
 *   file: it never spreads into chat code, pauses when the document is
 *   hidden or the element is offscreen, caps DPR at 1.5, draws one static
 *   frame under prefers-reduced-motion, and cleans up on unmount.
 *
 * Privacy note: purely decorative activity indicator — it carries no content,
 * so it can never leak private model reasoning.
 * Independently replaceable per the reference component contract.
 */

import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

export type ThinkingOrbState = "idle" | "thinking" | "solving" | "done";

export interface ThinkingOrbProps {
  state?: ThinkingOrbState;
  /** Orb diameter px (classic path). Default 44. Ignored in "solving" pill mode. */
  size?: number;
  /** Accessible label; visible caption inside the solving pill. Default "AI activity". */
  label?: string;
  className?: string;
}

/* ------------------------------------------------------------------ */
/* Canvas orb (Phase 8B "solving" — reference reconstruction)          */
/* ------------------------------------------------------------------ */

/** Reference geometry: 64px canvas, 56px visible orb, 74px pill. */
const CANVAS_SIZE = 64;
const VISIBLE_ORB_PX = 56;
const PILL_MIN_WIDTH = 74;
const PILL_HEIGHT = 74;

/** Reference palette (same warm ramp as the classic path). */
const RAMP: [number, string][] = [
  [0.0, "#ffc857"],
  [0.35, "#f2a95c"],
  [0.62, "#d98e4a"],
  [0.85, "#8a3413"],
  [1.0, "#4c1d07"],
];

/** One orb frame at time `t` (seconds). Pure canvas — no React state. */
function drawOrbFrame(ctx: CanvasRenderingContext2D, t: number): void {
  const size = CANVAS_SIZE;
  const c = size / 2;
  const r = VISIBLE_ORB_PX / 2;
  const speed = 1; // reference `speed: 1`

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(c, c);

  // Soft breathing (solving is gently alive, never jittery).
  const breathe = 1 + 0.03 * Math.sin((t * speed * 2 * Math.PI) / 2.4);
  ctx.scale(breathe, breathe);

  // Ambient glow behind the core.
  const glow = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.18);
  glow.addColorStop(0, "rgba(255, 200, 87, 0.26)");
  glow.addColorStop(1, "rgba(255, 200, 87, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);

  // Layered radial core (reference "classic" variant).
  const core = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.08, 0, 0, r);
  for (const [stop, color] of RAMP) core.addColorStop(stop, color);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = core;
  ctx.fill();

  // Rim + bottom inner shadow (dark theme depth).
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
  ctx.stroke();
  const innerShadow = ctx.createRadialGradient(0, r * 0.55, r * 0.1, 0, 0, r);
  innerShadow.addColorStop(0, "rgba(0, 0, 0, 0.28)");
  innerShadow.addColorStop(0.55, "rgba(0, 0, 0, 0)");
  ctx.beginPath();
  ctx.arc(0, 0, r - 0.5, 0, Math.PI * 2);
  ctx.fillStyle = innerShadow;
  ctx.fill();

  // Rotating highlight arc (the classic sweep).
  const angle = (t * speed * 2 * Math.PI) / 5.5;
  ctx.save();
  ctx.rotate(angle);
  const hl = ctx.createLinearGradient(-r, 0, r, 0);
  hl.addColorStop(0, "rgba(255, 236, 190, 0)");
  hl.addColorStop(0.5, "rgba(255, 236, 190, 0.5)");
  hl.addColorStop(1, "rgba(255, 236, 190, 0)");
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, -0.62 * Math.PI, -0.12 * Math.PI);
  ctx.strokeStyle = hl;
  ctx.lineWidth = r * 0.3;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  // Fixed specular highlight (top-left light source).
  ctx.beginPath();
  ctx.arc(-r * 0.36, -r * 0.44, r * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.42)";
  ctx.fill();

  ctx.restore();
}

/**
 * Phase 8D additive export: the solving orb's frame renderer, reused by the
 * compact 22px `SolvingOrb` (components/ai-activity) so the supplied
 * animation has ONE source of truth. No behavior of this component changes.
 */
export { drawOrbFrame };

/** Canvas host for the solving pill: rAF loop, visibility/offscreen pause,
    DPR ≤ 1.5, reduced-motion static frame, full cleanup on unmount. */
function SolvingOrbCanvas({ reduced }: { reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = CANVAS_SIZE * dpr;
    canvas.height = CANVAS_SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf = 0;
    let inView = true;
    const epoch = performance.now();

    const frame = (now: number): void => {
      drawOrbFrame(ctx, (now - epoch) / 1000);
      raf = requestAnimationFrame(frame);
    };
    const start = (): void => {
      if (raf === 0 && !document.hidden && inView) raf = requestAnimationFrame(frame);
    };
    const stop = (): void => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    if (reduced) {
      // One honest static frame — no loop, no motion.
      drawOrbFrame(ctx, 0.9);
      return () => undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? false;
      if (inView) start();
      else stop();
    });
    observer.observe(canvas);
    const onVisibility = (): void => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
      className="shrink-0"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Classic orb (existing framer path — unchanged behavior)             */
/* ------------------------------------------------------------------ */

/** Ring rotation period (seconds) — deliberately slower than the breath. */
const RING_SPIN_S = 5.5;
/** Breathing loop period (seconds), per the reference spec. */
const BREATH_S = 2.4;

/** Warm radial core — supplied reference palette (#ffc857 → #d98e4a → #8a3413). */
const CORE_GRADIENT =
  "radial-gradient(circle at 38% 32%, #ffc857 0%, #ffc857 14%, #d98e4a 46%, #8a3413 78%, #4c1d07 100%)";

const CORE_STYLE: CSSProperties = {
  background: CORE_GRADIENT,
  boxShadow:
    "inset 0 1px 2px rgba(255, 255, 255, 0.25), inset 0 -3px 6px rgba(0, 0, 0, 0.4)",
};

/** Conic highlight arc; `success` flips the arc to the success token color. */
function ringGradient(success: boolean): string {
  const tone = success ? "var(--success)" : "#ffc857";
  return `conic-gradient(from 0deg, transparent 0deg, transparent 50deg, ${tone} 140deg, transparent 240deg, transparent 360deg)`;
}

function ClassicOrb({
  state,
  size,
  label,
  className,
  reduced,
}: {
  state: Exclude<ThinkingOrbState, "solving">;
  size: number;
  label: string;
  className?: string;
  reduced: boolean;
}) {
  const thinking = state === "thinking";
  const done = state === "done";

  /* Ring: branch-rendered so stopping never spins backwards; framer owns all
     cleanup when the motion node unmounts. Reduced motion → static span. */
  let ring: ReactNode;
  if (reduced || !thinking) {
    ring = (
      <span
        aria-hidden="true"
        className="absolute inset-[2px] rounded-full"
        style={{
          background: ringGradient(done),
          opacity: done ? 0.9 : 0.3,
          transform: "rotate(35deg)",
        }}
      />
    );
  } else {
    ring = (
      <motion.span
        aria-hidden="true"
        className="absolute inset-[2px] rounded-full"
        style={{ background: ringGradient(false) }}
        initial={{ opacity: 0 }}
        animate={{ rotate: 360, opacity: 0.85 }}
        transition={{
          rotate: { duration: RING_SPIN_S, ease: "linear", repeat: Infinity },
          opacity: { duration: motionDuration.base, ease: motionEase.outSoft },
        }}
      />
    );
  }

  /* Core: breathing while thinking, brief settle on done, static otherwise. */
  let core: ReactNode;
  if (reduced) {
    core = (
      <span
        aria-hidden="true"
        className="absolute inset-[5px] rounded-full"
        style={CORE_STYLE}
      />
    );
  } else if (thinking) {
    core = (
      <motion.span
        aria-hidden="true"
        className="absolute inset-[5px] rounded-full"
        style={CORE_STYLE}
        initial={false}
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: BREATH_S, ease: motionEase.inOut, repeat: Infinity }}
      />
    );
  } else if (done) {
    core = (
      <motion.span
        aria-hidden="true"
        className="absolute inset-[5px] rounded-full"
        style={CORE_STYLE}
        initial={{ scale: 1.05 }}
        animate={{ scale: 1 }}
        transition={{ duration: motionDuration.slow, ease: motionEase.outSoft }}
      />
    );
  } else {
    core = (
      <span
        aria-hidden="true"
        className="absolute inset-[5px] rounded-full"
        style={CORE_STYLE}
      />
    );
  }

  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-background",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {ring}
      {core}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function ThinkingOrb({
  state = "thinking",
  size = 44,
  label = "AI activity",
  className,
}: ThinkingOrbProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced);

  if (state === "solving") {
    /* Phase 8B reference pill: 74px dark capsule, 56px visible orb canvas,
       label inside. Canvas loop pauses offscreen/hidden; static when the
       user prefers reduced motion. */
    return (
      <span
        role="status"
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center gap-2.5 rounded-full border border-[#2b2119] bg-[#141110] pl-[5px] pr-4",
          className,
        )}
        style={{ minWidth: PILL_MIN_WIDTH, height: PILL_HEIGHT }}
      >
        <SolvingOrbCanvas reduced={reduced} />
        <span className="max-w-[160px] truncate text-[13px] font-medium text-[#e8dcc8]">
          {label}
        </span>
      </span>
    );
  }

  return (
    <ClassicOrb
      state={state}
      size={size}
      label={label}
      className={className}
      reduced={reduced}
    />
  );
}
