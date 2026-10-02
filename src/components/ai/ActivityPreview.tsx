"use client";

/**
 * CodeMind X V2 — ActivityPreview (public-site demo panel)
 *
 * Realistic preview of the CodeMind X AI activity engine: orb + mono status
 * line, a ThoughtChain that plays a six-step activity sequence once when the
 * panel enters the viewport, and a footer that states the privacy contract.
 *
 * PRIVACY CONTRACT: every label below is a short system-activity message —
 * categories only, never private model chain-of-thought.
 *
 * Choreography: sequential pending → active → done (~900ms per step), runs
 * ONCE, settles, and can be replayed via the ghost button. The sequencer
 * pauses while the document is hidden; all timers are cleaned up. Reduced
 * motion: every step is shown done immediately and no timers run.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { DemoBadge } from "@/components/product/shared";
import type { ActivityKind } from "@/types/contracts";
import { LatticeLoader } from "./LatticeLoader";
import { ThinkingOrb, type ThinkingOrbState } from "./ThinkingOrb";
import {
  ThoughtChain,
  type ThoughtStep,
  type ThoughtStepStatus,
} from "./ThoughtChain";

export interface ActivityPreviewProps {
  className?: string;
}

/** Milliseconds per step (pending → active → done). */
const STEP_MS = 900;

/** Fixed demo script — ids are stable so rows never remount. */
const DEMO_STEPS: readonly { id: string; kind: ActivityKind; label: string }[] = [
  { id: "step-search", kind: "search", label: "Searching repository for auth modules" },
  { id: "step-read", kind: "read", label: "Reading src/server/security/middleware.ts" },
  { id: "step-plan", kind: "plan", label: "Planning verification approach" },
  { id: "step-code", kind: "code", label: "Drafting proposed change" },
  { id: "step-test", kind: "test", label: "Running related tests" },
  { id: "step-finalize", kind: "finalize", label: "Summarizing result" },
];

/** Total sequence length; the demo settles (runs once) after this. */
const TOTAL_MS = STEP_MS * DEMO_STEPS.length;

export function ActivityPreview({ className }: ActivityPreviewProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced);

  const panelRef = useRef<HTMLDivElement>(null);
  const inView = useInView(panelRef, { once: true, amount: 0.35 });

  /* Sequencer clock: elapsed activity time, advanced only while visible. */
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);

  const running = inView && !reduced && elapsed < TOTAL_MS;

  useEffect(() => {
    if (!running) return;

    let last = performance.now();
    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      if (document.hidden) return; // sequencer paused while hidden
      const next = Math.min(elapsedRef.current + delta, TOTAL_MS);
      elapsedRef.current = next;
      setElapsed(next);
      if (next >= TOTAL_MS) window.clearInterval(intervalId);
    }, 120);

    // Drop any time that accumulated while the document was hidden.
    const onVisibility = () => {
      last = performance.now();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [running]);

  /* Statuses are derived, never stored per-step — replay is just a reset. */
  const statuses = useMemo<ThoughtStepStatus[]>(() => {
    if (reduced) return DEMO_STEPS.map(() => "done");
    if (!inView) return DEMO_STEPS.map(() => "pending");
    return DEMO_STEPS.map((_, i) => {
      if (elapsed >= (i + 1) * STEP_MS) return "done";
      if (elapsed >= i * STEP_MS) return "active";
      return "pending";
    });
  }, [reduced, inView, elapsed]);

  const steps: ThoughtStep[] = DEMO_STEPS.map((step, i) => ({
    ...step,
    status: statuses[i],
  }));

  const activeIndex = statuses.indexOf("active");
  const settled = reduced || (inView && elapsed >= TOTAL_MS);

  const statusLine = reduced
    ? "task complete — result summarized"
    : !inView
      ? "standing by — activity engine idle"
      : activeIndex >= 0
        ? DEMO_STEPS[activeIndex].label
        : "task complete — result summarized";

  const orbState: ThinkingOrbState = settled ? "done" : inView ? "thinking" : "idle";

  const replay = () => {
    elapsedRef.current = 0;
    setElapsed(0);
  };

  return (
    <div
      ref={panelRef}
      className={cn("rounded-md border border-border bg-surface p-3 sm:p-4", className)}
    >
      {/* Header: orb + live status line + honesty badge. */}
      <header className="flex items-center gap-2.5">
        <ThinkingOrb size={28} state={orbState} label="AI activity demo" />
        <p
          aria-live="polite"
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
        >
          {statusLine}
        </p>
        <DemoBadge />
      </header>

      {/* Body: privacy-safe activity chain. */}
      <div className="mt-3">
        <ThoughtChain steps={steps} dense />
      </div>

      {/* Footer: loader + privacy contract caption + replay. */}
      <footer className="mt-3 flex items-center gap-2 border-t border-border-subtle pt-2.5">
        <LatticeLoader cellSize={5} label="Activity stream" />
        <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
          activity stream — categories only, no private reasoning
        </p>
        <button
          type="button"
          onClick={replay}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-muted-foreground",
            "transition-colors hover:bg-surface-elevated hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus",
          )}
        >
          <RotateCcw className="size-3" aria-hidden="true" />
          Replay
        </button>
      </footer>
    </div>
  );
}
