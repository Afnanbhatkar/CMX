"use client";

/**
 * CodeMind X V2 — LatticeLoader (AI activity reference component)
 *
 * 3×3 lattice of small cells playing a diagonal wave, timed with
 * requestAnimationFrame: the wave head is `floor(elapsed / interval) % 9`
 * and the two trailing cells behind it (in diagonal visit order) stay lit,
 * so neighbors activate with a slight offset — a comet sweeping the grid.
 *
 * The rAF loop pauses when the document is hidden and when the element is
 * offscreen (IntersectionObserver); everything is cleaned up on unmount.
 * Reduced motion: static diagonal of 3 active cells, no loop.
 * Independently replaceable per the reference component contract.
 */

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface LatticeLoaderProps {
  /** Cell size px. Default 6. */
  cellSize?: number;
  className?: string;
  /** Accessible label. Default "Working". */
  label?: string;
}

/** Grid size (3×3). */
const GRID = 9;
/** Wave head visit order — BFS across the (row + col) diagonals. */
const WAVE_ORDER = [0, 1, 3, 2, 4, 6, 5, 7, 8] as const;
/** Cells lit at once: the head plus its trailing neighbors. */
const WAVE_TRAIL = 3;
/** Milliseconds per wave step. */
const STEP_INTERVAL_MS = 220;

export function LatticeLoader({
  cellSize = 6,
  className,
  label = "Working",
}: LatticeLoaderProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced);
  const [tick, setTick] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  /** Latest wave step, kept so pausing/resuming never jumps the pattern. */
  const tickRef = useRef(0);
  const inViewRef = useRef(false);

  useEffect(() => {
    if (reduced) return; // static diagonal is derived in render; no loop

    let raf = 0;
    let epoch = 0;
    let lastTick = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const current = Math.floor((now - epoch) / STEP_INTERVAL_MS);
      if (current !== lastTick) {
        lastTick = current;
        tickRef.current = current;
        setTick(current);
      }
    };

    const stop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const play = () => {
      if (raf !== 0 || document.hidden || !inViewRef.current) return;
      // Resume from the current wave position so pausing never jumps.
      epoch = performance.now() - tickRef.current * STEP_INTERVAL_MS;
      lastTick = tickRef.current;
      raf = requestAnimationFrame(frame);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else play();
    };

    const observer = new IntersectionObserver((entries) => {
      inViewRef.current = entries[0]?.isIntersecting ?? false;
      if (inViewRef.current) play();
      else stop();
    });

    if (hostRef.current) observer.observe(hostRef.current);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced]);

  /* Derived active set — pure function of (tick, reduced), SSR-safe. */
  const active = new Array<boolean>(GRID).fill(false);
  if (reduced) {
    active[0] = true;
    active[4] = true;
    active[8] = true;
  } else {
    const head = ((tick % GRID) + GRID) % GRID;
    for (let k = 0; k < WAVE_TRAIL; k += 1) {
      active[WAVE_ORDER[(head - k + GRID) % GRID]] = true;
    }
  }

  return (
    <div
      ref={hostRef}
      role="status"
      aria-label={`${label}…`}
      className={cn("inline-grid shrink-0 grid-cols-3 gap-[2px]", className)}
    >
      {active.map((on, index) => (
        <span
          // Cell positions are fixed; the wave only flips colors.
          key={index}
          aria-hidden="true"
          className={cn(
            "rounded-[1px] transition-colors duration-150",
            on ? "bg-primary" : "bg-muted-foreground/20",
          )}
          style={{ width: cellSize, height: cellSize }}
        />
      ))}
    </div>
  );
}
