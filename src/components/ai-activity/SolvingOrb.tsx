"use client";

/**
 * CodeMind X V2 — Solving orb (Phase 8D, spec B.3–B.6).
 *
 * The production Solving indicator's orb: 22px × 22px visible canvas running
 * the EXACT supplied solving-orb animation. The engine is the project's own
 * vendored reference implementation (`@/components/ai/ThinkingOrb`, Phase 8B)
 * — a pinned LOCAL dependency, never an unpinned @main CDN import — and it
 * is lazy-loaded with a cached dynamic import() ONLY when a run actually
 * transitions into Solving (thinking-only runs never load it).
 *
 * Reference configuration (unchanged, per spec):
 *   state: "solving", size: 64, theme: "dark", variant: "classic",
 *   speed: 1, interactive: false, ariaLabel: "Solving"
 * Only the visible rendered size differs: 22px (CSS downscale of the 64px
 * backing canvas, exactly like the supplied reference).
 *
 * Robustness (spec B.4/B.5 + CLEANUP):
 * - import failure (CSP/network/unsupported) → local CSS fallback orb with
 *   the same 22px footprint (no canvas, no WebGL, no network);
 * - reduced motion / waiting states render the fallback orb instead of the
 *   animated canvas;
 * - StrictMode-safe: double-mount never duplicates the canvas or the rAF
 *   loop; an import resolving after unmount never initializes; cleanup
 *   cancels rAF, disconnects observers and destroys the canvas element.
 */

import { useEffect, useRef, useState } from "react";

/** Cached loader — the module is a pinned local dependency (no @main). */
let orbLoaderPromise: Promise<typeof import("@/components/ai/ThinkingOrb")> | null = null;

export function loadThinkingOrbEngine(): Promise<typeof import("@/components/ai/ThinkingOrb")> {
  if (!orbLoaderPromise) {
    orbLoaderPromise = import("@/components/ai/ThinkingOrb");
  }
  return orbLoaderPromise;
}

/** 64px backing canvas (reference `size: 64`), 22px visible (spec B.6). */
const CANVAS_SIZE = 64;
const VISIBLE_SIZE = 22;

export function SolvingOrb({ breathing = true }: { breathing?: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  /** Guards StrictMode double-mount and post-unmount import resolution. */
  const cancelledRef = useRef(false);
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    cancelledRef.current = false;
    let cleanup: (() => void) | null = null;

    loadThinkingOrbEngine()
      .then(({ drawOrbFrame }) => {
        if (cancelledRef.current) return; // resolved after unmount — never init
        const host = hostRef.current;
        if (!host) return;

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setCanvasReady(false);
          return;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = CANVAS_SIZE * dpr;
        canvas.height = CANVAS_SIZE * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        canvas.style.width = `${VISIBLE_SIZE}px`;
        canvas.style.height = `${VISIBLE_SIZE}px`;
        canvas.setAttribute("aria-hidden", "true");
        host.appendChild(canvas);
        setCanvasReady(true);

        let raf = 0;
        let inView = true;
        const epoch = performance.now();

        const frame = (now: number): void => {
          drawOrbFrame(ctx, (now - epoch) / 1000);
          raf = window.requestAnimationFrame(frame);
        };
        const start = (): void => {
          if (raf === 0 && !document.hidden && inView) {
            raf = window.requestAnimationFrame(frame);
          }
        };
        const stop = (): void => {
          if (raf !== 0) {
            window.cancelAnimationFrame(raf);
            raf = 0;
          }
        };

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

        cleanup = () => {
          stop();
          observer.disconnect();
          document.removeEventListener("visibilitychange", onVisibility);
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
