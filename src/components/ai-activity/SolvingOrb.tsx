"use client";

/**
 * CodeMind X V2 — Solving orb (Phase 9.1, user-supplied reference 1:1).
 *
 * The EXACT orb from the user's reference snippet: the `thinking-orbs`
 * library's `createThinkingOrb` running state "solving" —
 *
 *   createThinkingOrb(target, {
 *     state: "solving",
 *     size: 64,
 *     theme: "dark",
 *     variant: "classic",
 *     speed: 1,
 *     interactive: false,
 *     ariaLabel: "Solving",
 *   });
 *
 * with the canvas displayed at 56px (the snippet's #orb footprint: the
 * 64px backing store shown at 56px, exactly like the reference page).
 *
 * The library is vendored 1:1 in `thinking-orbs.js` (the same module the
 * snippet loaded from the CDN) and lazy-loaded with a cached dynamic
 * import() ONLY when a run actually transitions into Solving — thinking-
 * only runs never load it. The library owns the whole render lifecycle:
 * rAF loop, DPR handling, hidden-tab/offscreen pausing, and the static
 * frame under prefers-reduced-motion.
 *
 * Robustness:
 * - import failure → local CSS fallback orb (no canvas, no network);
 * - StrictMode-safe: double-mount never duplicates the canvas; a import
 *   resolving after unmount never initializes; cleanup destroys the orb
 *   instance (stops rAF, disconnects observers, removes the canvas).
 */

import { useEffect, useRef, useState } from "react";

/** Shape of the vendored library's controller instance (subset we use). */
interface ThinkingOrbInstance {
  destroy?: (options?: { removeCanvas?: boolean }) => void;
}

type ThinkingOrbOptions = {
  state: string;
  size: number;
  theme: string;
  variant: string;
  speed: number;
  interactive: boolean;
  ariaLabel?: string;
};

type ThinkingOrbsModule = {
  createThinkingOrb: (
    target: HTMLElement,
    options: ThinkingOrbOptions,
  ) => ThinkingOrbInstance;
};

/** Cached loader — the engine module is a pinned local file (no CDN). */
let orbLibPromise: Promise<ThinkingOrbsModule> | null = null;

export function loadThinkingOrbsLibrary(): Promise<ThinkingOrbsModule> {
  if (!orbLibPromise) {
    orbLibPromise = import("./thinking-orbs").then((mod) => mod as ThinkingOrbsModule);
  }
  return orbLibPromise;
}

/** Visible canvas footprint — the reference snippet's exact 56px. */
const VISIBLE_SIZE = 56;

export function SolvingOrb({ breathing = true }: { breathing?: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  /** Guards StrictMode double-mount and post-unmount import resolution. */
  const cancelledRef = useRef(false);
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    cancelledRef.current = false;
    let instance: ThinkingOrbInstance | null = null;

    loadThinkingOrbsLibrary()
      .then((lib) => {
        if (cancelledRef.current) return; // resolved after unmount — never init
        const host = hostRef.current;
        if (!host) return;

        // The user's reference snippet, verbatim options.
        instance = lib.createThinkingOrb(host, {
          state: "solving",
          size: 64,
          theme: "dark",
          variant: "classic",
          speed: 1,
          interactive: false,
          ariaLabel: "Solving",
        });

        const canvas = host.querySelector("canvas");
        if (canvas) {
          canvas.style.width = `${VISIBLE_SIZE}px`;
          canvas.style.height = `${VISIBLE_SIZE}px`;
        }
        setCanvasReady(true);
      })
      .catch(() => {
        if (!cancelledRef.current) setCanvasReady(false);
      });

    return () => {
      cancelledRef.current = true;
      try {
        // destroy() stops the rAF loop, disconnects the library's observers
        // and (by default) removes its canvas element.
        instance?.destroy?.();
      } catch {
        // never throw during teardown
      }
      instance = null;
      const host = hostRef.current;
      if (host) host.replaceChildren();
      setCanvasReady(false);
    };
  }, []);

  return (
    <span
      ref={hostRef}
      className="cmx-act-orb cmx-act-orb-live"
      role="status"
      aria-label="Solving"
    >
      {canvasReady ? null : (
        <span
          aria-hidden="true"
          className="cmx-act-orb-fallback"
          data-breathing={breathing ? "true" : "false"}
        />
      )}
    </span>
  );
}
