"use client";

/**
 * CodeMind X V2 — ThinkingOrb (AI activity reference component)
 *
 * Self-contained "engine is working" indicator: a dark rounded container
 * holding a warm layered radial orb with a slowly rotating conic highlight
 * ring. States:
 * - "idle"     → static orb, ring dimmed
 * - "thinking" → rotating ring + soft breathing scale (1 → 1.04 → 1, ~2.4s)
 * - "done"     → ring flips to the success token, brief settle, then static
 *
 * Privacy note: purely decorative activity indicator — it carries no content,
 * so it can never leak private model reasoning.
 * Independently replaceable per the reference component contract.
 */

import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

export type ThinkingOrbState = "idle" | "thinking" | "done";

export interface ThinkingOrbProps {
  state?: ThinkingOrbState;
  /** Orb diameter px. Default 44. */
  size?: number;
  /** Accessible label + visible caption is handled by consumer; this is the aria-label. Default "AI activity". */
  label?: string;
  className?: string;
}

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

export function ThinkingOrb({
  state = "thinking",
  size = 44,
  label = "AI activity",
  className,
}: ThinkingOrbProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced);
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
