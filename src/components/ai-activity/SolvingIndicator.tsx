"use client";

/**
 * CodeMind X V2 — Solving indicator (Phase 8D, spec B.3/B.6/B.7; orb
 * resized to the Thinking footprint in Phase 9.2).
 *
 * [22px solving orb] Solving — the same compact row footprint as Thinking:
 * 22px orb + 14px label + 8.75px gap, same shimmer, same label position —
 * where "Thinking" reads, "Solving" reads in exactly that place (user
 * direction: the header swap must feel like the SAME indicator changing
 * its animation, never a move/resize). NO pill, NO background, NO
 * box-shadow, NO 74px container.
 *
 * Reduced motion renders the static fallback orb (never the animated
 * canvas); the animated canvas loads lazily only for a genuinely solving
 * run. The label is exactly "Solving".
 */

import { useReducedMotion } from "framer-motion";
import { SolvingOrb } from "./SolvingOrb";

export function SolvingIndicator() {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced);

  return (
    <span className="cmx-act-solving" role="status" aria-label="Solving">
      {reduced ? (
        <span className="cmx-act-orb" role="status" aria-label="Solving">
          <span aria-hidden="true" className="cmx-act-orb-fallback" data-breathing="false" />
        </span>
      ) : (
        <SolvingOrb breathing />
      )}
      <span className="cmx-act-label">
        <span className="cmx-act-shimmer-text">Solving</span>
      </span>
    </span>
  );
}

/**
 * Waiting indicator (spec A.3 + B.5): static fallback orb + the exact
 * waiting label ("Waiting for approval" / "Waiting for your answer").
 * Calm — no shimmer, no animated orb, the timer is paused.
 */
export function WaitingIndicator({ label }: { label: string }) {
  return (
    <span className="cmx-act-solving" role="status" aria-label={label}>
      <span className="cmx-act-orb" aria-hidden="true">
        <span className="cmx-act-orb-fallback" data-breathing="false" />
      </span>
      <span className="cmx-act-waiting-label">{label}</span>
    </span>
  );
}
