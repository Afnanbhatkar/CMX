"use client";

/**
 * CodeMind X V2 — Solving orb (Phase 8D, spec B.3–B.6 · prototype-exact).
 *
 * 22px × 22px visible canvas running the EXACT supplied prototype orb:
 * the dot-sphere engine vendored 1:1 in `orb-engine.ts` (resolved preset
 * for state "solving", size 64 — speed 1.82, latRings 9, lonDensity 24).
 * The prototype's render loop is preserved: DPR = min(2, devicePixelRatio),
 * transform per frame, epoch-based time × SPEED, a single static frame at
 * t = 0.6 under prefers-reduced-motion, and rAF that pauses when the
 * document is hidden or the element is offscreen.
 *
 * The engine is lazy-loaded with a cached dynamic import() ONLY when a run
 * actually transitions into Solving (thinking-only runs never load it).
 *
 * Robustness (spec B.4/B.5 + CLEANUP):
 * - import failure (CSP/network/unsupported) → local CSS fallback orb with
 *   the same 22px footprint (no canvas, no WebGL, no network);
 * - reduced motion / waiting states render the fallback orb instead of the
 *   animated canvas;
 * - StrictMode-safe: double-mount never duplicates the canvas or the rAF
 *   loop; an import resolving after unmount never initializes; cleanup
 *   cancels rAF, disconnects observers and removes the canvas element.
 */

import { useEffect, useRef, useState } from "react";

/** Cached loader — the engine module is a pinned local file (no CDN). */
let orbEnginePromise: Promise<typeof import("./orb-engine")> | null = null;

export function loadSolvingOrbEngine(): Promise<typeof import("./orb-engine")> {
  if (!orbEnginePromise) {
    orbEnginePromise = import("./orb-engine");
  }
  return orbEnginePromise;
}

/** 64px backing canvas (prototype `SIZE`), 22px visible (spec B.6). */
const VISIBLE_SIZE = 22;

export function SolvingOrb({ breathing = true }: { breathing?: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  /** Guards StrictMode double-mount and post-unmount import resolution. */
  const cancelledRef = useRef(false);
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    cancelledRef.current = false;
    let cleanup: (() => void) | null = null;

    loadSolvingOrbEngine()
      .then((engine) => {
        if (cancelledRef.current) return; // resolved after unmount — never init
        const host = hostRef.current;
        if (!host) return;

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setCanvasReady(false);
          return;
        }
        canvas.style.width = `${VISIBLE_SIZE}px`;
        canvas.style.height = `${VISIBLE_SIZE}px`;
        canvas.setAttribute("aria-hidden", "true");
        host.appendChild(canvas);
        setCanvasReady(true);

        /* Prototype frame loop: `render(t)` + rAF with hidden/offscreen
           pause and a reduced-motion static frame at t = 0.6. */
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const epoch = performance.now();
        let raf = 0;
        let running = true;
        let inView = true;

        const render = (time: number): void => {
          engine.renderSolvingOrbFrame(ctx, canvas, time);
        };
        const frame = (): void => {
          if (!running) return;
          render(reduced ? 0.6 : (performance.now() - epoch) / 1000 * engine.SOLVING_ORB_SPEED);
          if (!reduced && !document.hidden && inView) {
            raf = window.requestAnimationFrame(frame);
          } else {
            raf = 0;
          }
        };
        const start = (): void => {
          if (running && raf === 0 && !document.hidden && inView) frame();
        };
        const stop = (): void => {
          running = false;
          if (raf !== 0) {
            window.cancelAnimationFrame(raf);
            raf = 0;
          }
        };
        const resume = (): void => {
          running = true;
          start();
        };

        const observer = new IntersectionObserver((entries) => {
          inView = entries[0]?.isIntersecting ?? false;
          if (inView) resume();
          else stop();
        });
        observer.observe(canvas);

        const onVisibility = (): void => {
          if (document.hidden) stop();
          else resume();
        };
        document.addEventListener("visibilitychange", onVisibility);
        const onPageHide = (): void => stop();
        window.addEventListener("pagehide", onPageHide);
        start();

        cleanup = () => {
          stop();
          observer.disconnect();
          document.removeEventListener("visibilitychange", onVisibility);
          window.removeEventListener("pagehide", onPageHide);
          canvas.remove(); // destroy the orb instance's element
        };
      })
      .catch(() => {
        if (!cancelledRef.current) setCanvasReady(false);
      });

    return () => {
      cancelledRef.current = true;
      cleanup?.();
      cleanup = null;
      setCanvasReady(false);
    };
  }, []);

  return (
    <span ref={hostRef} className="cmx-act-orb" role="status" aria-label="Solving">
      {canvasReady ? null : (
        <span aria-hidden="true" className="cmx-act-orb-fallback" data-breathing={breathing ? "true" : "false"} />
      )}
    </span>
  );
}
