"use client";

/**
 * CodeMind X V2 — Solving orb (user-supplied reference, verbatim engine).
 *
 * The orb is EXACTLY the user's reference snippet — the `thinking-orbs`
 * library's `createThinkingOrb` (vendored 1:1 in `thinking-orbs.js`, the
 * same module the snippet loads from the CDN):
 *
 *   createThinkingOrb(target, {
 *     state: "solving",
 *     theme: "dark",
 *     variant: "classic",
 *     speed: 1,
 *     interactive: false,
 *     ariaLabel: "Solving",
 *   });
 *
 * displayed at the Thinking lattice's 22px footprint (standing user
 * direction: the orb lives exactly where "Thinking" reads, at the Thinking
 * animation's size, so the Thinking → Solving swap is an in-place
 * cross-fade — position and size are the established ones). The library
 * owns the whole render lifecycle: canvas, rAF loop, DPR handling,
 * hidden-tab/offscreen pausing, and the static frame under
 * prefers-reduced-motion. The library APPENDS its canvas to the target.
 *
 * LIBRARY SIZE CONSTRAINT (root cause of the "do do orb, ek black" bug):
 * createThinkingOrb validates size ∈ {32, 64, 96, 128} — any other value
 * THROWS "ThinkingOrb size must be 32, 64, 96, or 128" AFTER the canvas
 * has already been appended, which used to leave an unpaintable canvas
 * next to the permanently-on fallback ball (two orbs). The user's own
 * snippet is built around this constraint: it authors the orb at
 * size: 64 and displays the canvas smaller via CSS (64 → 56px there).
 * The exact same pattern is used here: author at 64 (library-legal,
 * snippet-verbatim), display at the established 22px footprint.
 *
 * SINGLE-ORB GUARANTEE (bug fix — "do do orb, ek black"):
 * the failure chain was: size: 22 (below) → createThinkingOrb THREW after
 * appending its canvas → the silent catch kept the fallback ball on →
 * grey/black CSS ball + library canvas rendered SIDE BY SIDE (two orbs).
 * Three independent guards now make that state impossible: (1) the
 * library-legal author size so creation succeeds at all; (2) the loading
 * ball is the HOST element's own CSS background (data-fallback), never a
 * React child — nothing can orphan it next to the canvas, and the canvas
 * simply draws OVER the host box while it loads; (3) the host is emptied
 * before init and after destroy (no stray canvases, rerun-safe).
 */

import { useEffect, useRef } from "react";

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

/**
 * Authoring vs display size.
 *
 * The library only accepts {32, 64, 96, 128} (see the header comment) —
 * the user's reference snippet authors at 64 and CSS-displays smaller;
 * this component does the same: author 64, display at the Thinking
 * lattice's 22px footprint so the header cross-fade never shifts.
 */
const ORB_AUTHOR_SIZE = 64; // library-legal size — user snippet verbatim
const DISPLAY_SIZE = 22; // established Thinking-lattice footprint

export function SolvingOrb({ breathing = true }: { breathing?: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    /** Per-effect closure guard for remount/post-unmount resolution. */
    let cancelled = false;
    let instance: ThinkingOrbInstance | null = null;

    // Fallback ball = the host's own background (never a child element —
    // see the single-orb guarantee in the header comment).
    host.dataset.fallback = "true";

    loadThinkingOrbsLibrary()
      .then((lib) => {
        if (cancelled) return; // resolved after unmount — never init
        // The host MUST be empty before the library appends its canvas —
        // no stray sibling can ever sit next to the real orb.
        host.replaceChildren();

        // The user's reference snippet options — authored at the
        // library-legal size, displayed at the established footprint.
        instance = lib.createThinkingOrb(host, {
          state: "solving",
          size: ORB_AUTHOR_SIZE,
          theme: "dark",
          variant: "classic",
          speed: 1,
          interactive: false,
          ariaLabel: "Solving",
        });

        const canvas = host.querySelector("canvas");
        if (canvas) {
          canvas.style.width = `${DISPLAY_SIZE}px`;
          canvas.style.height = `${DISPLAY_SIZE}px`;
        }
        // Same element, imperative flip — the ball disappears the moment
        // the real orb exists. No React render involved.
        host.dataset.fallback = "false";
      })
      .catch((err: unknown) => {
        // Honest failure signal — with library-legal options this never
        // fires; if it ever does, the fallback ball remains (one orb).
        console.error("[SolvingOrb] createThinkingOrb failed:", err);
        if (!cancelled) host.dataset.fallback = "true";
      });

    return () => {
      cancelled = true;
      try {
        // destroy() stops the rAF loop and disconnects the library's
        // observers; replaceChildren() then removes the canvas element.
        instance?.destroy?.();
      } catch {
        // never throw during teardown
      }
      instance = null;
      host.replaceChildren();
      host.dataset.fallback = "true";
    };
  }, []);

  return (
    <span
      ref={hostRef}
      className="cmx-act-orb cmx-act-orb-live"
      role="status"
      aria-label="Solving"
      data-fallback="true"
      data-breathing={breathing ? "true" : "false"}
    />
  );
}
