"use client";

/**
 * CodeMind X V2 — LatticeLoader (AI activity reference component, Phase 8B).
 *
 * Native React reconstruction of the user-supplied Lattice Loader reference:
 * nine cells in a 3×3 grid (6px cells, 2px gap) playing a staggered
 * opacity wave driven purely by CSS — each cell runs the same `lattice-on`
 * keyframes (idle 0.15 → peak 1 → idle, 648ms cycle) with the reference's
 * exact per-cell delays:
 *
 *     90ms 180ms 270ms
 *       0ms  90ms 180ms
 *      90ms 180ms 270ms
 *
 * When `startedAt` is provided a stopwatch label counts real elapsed time
 * via requestAnimationFrame — the reference timer behavior, kept honest:
 * the number shown is measured, never invented.
 *
 * Accessibility: `role="status"` announces the label; the timer is a polite
 * live region. Reduced motion: the CSS wave is disabled (static diagonal)
 * — the stopwatch itself is text, not motion, and keeps counting.
 * The rAF loop pauses while the document is hidden. Everything is cleaned
 * up on unmount. Independently replaceable per the reference contract.
 */

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface LatticeLoaderProps {
  /** Cell size px. Default 6 (reference `--cell`). */
  cellSize?: number;
  className?: string;
  /** Accessible label + status text. Default "Working". */
  label?: string;
  /**
   * Epoch ms timestamp the measured stopwatch counts from. When provided,
   * the loader renders the reference timer ("X.Xs") next to the lattice.
   */
  startedAt?: number | null;
  /** Force the timer on/off; defaults to "shown when startedAt is set". */
  showTimer?: boolean;
}

/** Reference staggered delays (ms), row-major over the 3×3 grid. */
const CELL_DELAYS_MS = [90, 180, 270, 0, 90, 180, 90, 180, 270] as const;

/** Reference animation cycle. */
const CYCLE_MS = 648;

/** Self-contained keyframes — the component stays independently replaceable. */
const LATTICE_KEYFRAMES = `
@keyframes lattice-on {
  0%, 100% { opacity: 0.15; }
  18%, 42% { opacity: 1; }
  62% { opacity: 0.15; }
}
`;

export function LatticeLoader({
  cellSize = 6,
  className,
  label = "Working",
  startedAt = null,
  showTimer,
}: LatticeLoaderProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced);
  const timerRef = useRef<HTMLSpanElement>(null);
  const timerVisible = showTimer ?? startedAt !== null;

  /* Reference timer behavior: one rAF loop writing measured elapsed time
     into the DOM node directly (no per-frame React renders). rAF timestamps
     are performance.now()-based (NOT epoch), so the wall-clock offset to
     `startedAt` is captured once and applied per frame. Paused while the
     document is hidden; cancelled on unmount. */
  useEffect(() => {
    if (!timerVisible || startedAt === null) return;

    const perf0 = performance.now();
    const wallOffset = Date.now() - startedAt;

    let raf = 0;
    const tick = (rafNow: number) => {
      const node = timerRef.current;
      if (node) {
        const elapsedMs = rafNow - perf0 + wallOffset;
        node.textContent = `${(Math.max(0, elapsedMs) / 1000).toFixed(1)}s`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onVisibility = (): void => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (raf === 0) {
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [startedAt, timerVisible]);

  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex shrink-0 items-center gap-2", className)}
    >
      {/* Keyframes live with the component so it stays self-contained. */}
      <style dangerouslySetInnerHTML={{ __html: LATTICE_KEYFRAMES }} />
      <span
        aria-hidden="true"
        className="inline-grid"
        style={{
          gridTemplateColumns: "repeat(3, auto)",
          gap: "2px", // reference --gap
        }}
      >
        {CELL_DELAYS_MS.map((delay, index) => {
          const staticOn = reduced && (index === 0 || index === 4 || index === 8);
          return (
            <span
              // Cell positions are fixed; only opacity animates.
              key={index}
              className="rounded-[1px] bg-primary"
              style={
                reduced
                  ? // prefers-reduced-motion: no CSS wave — a static diagonal
                    // of three lit cells says "active" without movement.
                    { width: cellSize, height: cellSize, opacity: staticOn ? 1 : 0.15 }
                  : {
                      width: cellSize,
                      height: cellSize,
                      opacity: 0.15, // idle state before the (delayed) animation starts
                      animation: `lattice-on ${CYCLE_MS}ms linear ${delay}ms infinite`,
                    }
              }
            />
          );
        })}
      </span>
      {timerVisible ? (
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
          <span>{label}</span>
          <span
            ref={timerRef}
            aria-hidden="true"
            className="tabular-nums text-muted-foreground/80"
          >
            0.0s
          </span>
        </span>
      ) : null}
    </span>
  );
}
