"use client";

import { motion, useReducedMotion } from "framer-motion";
import { motionDuration, motionEase, SWEEP_GRADIENT } from "@/lib/design-tokens";
import { useCallback, useEffect, useRef, useState } from "react";

export interface DiaTextRevealProps {
  /** A single phrase, or a sequence of phrases shown one after another. */
  text: string | string[];
  /** Loop the sequence (or re-run a single phrase) forever. */
  repeat?: boolean;
  /** Speed multiplier — higher is faster. */
  speed?: number;
  /** Seconds each phrase holds once fully revealed. */
  hold?: number;
  className?: string;
  onCycleComplete?: (phraseIndex: number) => void;
  forceReducedMotion?: boolean;
}

/**
 * DiaTextReveal — native reconstruction of the supplied reference.
 *
 * Characteristics: gradient sweep synchronized with a clipped word reveal,
 * optional replay, responsive typography (fluid clamp sizing), reduced-motion
 * fallback that renders text statically with no sweep.
 *
 * Self-contained: all animation is element-scoped (no global CSS pollution),
 * timers are cleaned up deterministically.
 */
export function DiaTextReveal({
  text,
  repeat = false,
  speed = 1,
  hold = 1.4,
  className,
  onCycleComplete,
  forceReducedMotion = false,
}: DiaTextRevealProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced) || forceReducedMotion;
  const phrases = (Array.isArray(text) ? text : [text]).map((p) => p.split(/\s+/).filter(Boolean));

  const [phraseIndex, setPhraseIndex] = useState(0);
  const timerRef = useRef<number | null>(null);

  const words = phrases[Math.min(phraseIndex, phrases.length - 1)];
  const wordStagger = 0.09 / Math.max(speed, 0.01);
  const wordDuration = motionDuration.slow / Math.max(speed, 0.01);
  const cycleSeconds = words.length * wordStagger + wordDuration + hold;

  useEffect(() => {
    if (phrases.length <= 1 && !repeat) return;

    timerRef.current = window.setTimeout(
      () => {
        setPhraseIndex((i) => {
          const next = (i + 1) % phrases.length;
          if (next === 0 || phrases.length === 1) onCycleComplete?.(i);
          return next;
        });
      },
      (reduced ? Math.max(cycleSeconds, 2.2) : cycleSeconds) * 1000,
    );

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [phraseIndex, repeat, reduced, cycleSeconds, onCycleComplete, phrases.length]);

  const sweep = useCallback(
    (node: HTMLSpanElement | null) => {
      // no-op ref consumer; kept for future measurement needs
      void node;
    },
    [],
  );

  // ── Reduced motion: static text, no sweep, no clipping ──────────────
  if (reduced) {
    return (
      <span className={className} role="text" aria-label={words.join(" ")}>
        <span aria-hidden>{words.join(" ")}</span>
      </span>
    );
  }

  return (
    <span
      ref={sweep}
      className={`relative inline-block ${className ?? ""}`}
      role="text"
      aria-label={words.join(" ")}
      style={{ fontSize: "clamp(2rem, 5.5vw, 4rem)" }}
    >
      <span aria-hidden className="inline-flex flex-wrap gap-x-[0.28em]">
        {words.map((word, i) => (
          <span key={`${phraseIndex}-${i}`} className="inline-block overflow-hidden pb-[0.08em] -mb-[0.08em]">
            <motion.span
              className="inline-block"
              initial={{ y: "112%" }}
              animate={{ y: "0%" }}
              transition={{
                duration: wordDuration,
                delay: i * wordStagger,
                ease: motionEase.outSoft,
              }}
            >
              {word}
            </motion.span>
          </span>
        ))}
      </span>

      {/* Gradient sweep — travels under the text in sync with the reveal */}
      <motion.span
        aria-hidden
        className="absolute bottom-0 left-0 h-[2px] w-full origin-left"
        style={{
          backgroundImage: `linear-gradient(90deg, ${SWEEP_GRADIENT.join(", ")})`,
        }}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: [0, 1, 1], opacity: [0, 1, 0] }}
        transition={{
          duration: cycleSeconds,
          times: [0, 0.55, 1],
          ease: motionEase.inOut,
        }}
      />
    </span>
  );
}
