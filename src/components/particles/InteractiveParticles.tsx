"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface InteractiveParticlesProps {
  /** Base particle count on desktop. */
  density?: number;
  /** Motion multiplier 0.25–3. */
  speed?: number;
  /** Enable pointer attraction interaction (pointer-fine devices only). */
  interactive?: boolean;
  /** `true` forces low-power mode; `auto` detects coarse pointers / narrow viewports. */
  mobileMode?: boolean | "auto";
  /** `true` renders a single static frame (no loop); `auto` follows prefers-reduced-motion. */
  reducedMotion?: boolean | "auto";
  /** Node rendered instead of the canvas when canvas init fails. */
  fallback?: ReactNode;
  className?: string;
}

/* ── Tuning constants ───────────────────────────────────────────────── */
const CONNECT_DISTANCE = 110; // px — link radius between nodes (desktop)
const CONNECT_DISTANCE_LOW_POWER = 80; // px — reduced link radius (mobile mode)
const POINTER_RADIUS = 140; // px — attraction falloff radius
const DRIFT_MIN = 3; // px/s — slowest base drift
const DRIFT_MAX = 12; // px/s — fastest base drift
const ATTRACT_ACCEL = 30; // px/s² — attraction ceiling (gentle by design)
const MAX_SPEED = 26; // px/s — hard velocity clamp (before speed multiplier)
const RELAX_RATE = 1.2; // 1/s — how fast velocity relaxes back to base drift
const DPR_CAP = 2; // performance budget: devicePixelRatio ≤ 2
const MOBILE_DENSITY = 0.4; // particle count multiplier in low-power mode
const ACCENT_RATIO = 0.15; // share of copper accent nodes

/* ── Palette (CodeMind warm neutrals + copper accent) ───────────────── */
const NODE_COLOR = "rgba(214, 209, 200, 0.55)"; // warm gray
const ACCENT_COLOR = "rgba(217, 142, 74, 0.8)"; // copper
const LINK_COLOR = "rgba(214, 209, 200, 0.08)";
const TAU = Math.PI * 2;

/** A repository-network node drifting through the field. */
interface Particle {
  x: number;
  y: number;
  /** Base drift velocity (px/s) — the particle relaxes back toward this. */
  bx: number;
  by: number;
  /** Current velocity (px/s). */
  vx: number;
  vy: number;
  /** Node radius in px (1–2.5). */
  r: number;
  accent: boolean;
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), max);

/**
 * InteractiveParticles — canvas-2D repository-network particle field for
 * hero backgrounds. Purely presentational leaf component.
 *
 * Guarantees:
 * - Canvas 2D only (no WebGL); init failure → CSS gradient fallback, never
 *   breaks the page.
 * - DPR ≤ 2 (≤ 1.5 in low-power mode); canvas sized from the container via
 *   ResizeObserver — never a fixed 100vh.
 * - The rAF loop STOPS when the document is hidden or the canvas is
 *   offscreen, and resumes when visible again.
 * - Reduced motion renders ONE static, evenly-distributed frame with no
 *   loop and no pointer listeners.
 * - Pointer attraction is gentle: capped force, damped relaxation toward
 *   base drift, hard max-speed clamp — never explosive.
 * - Every listener, observer and animation frame is removed on unmount.
 */
export function InteractiveParticles({
  density = 70,
  speed = 1,
  interactive = true,
  mobileMode = "auto",
  reducedMotion = "auto",
  fallback,
  className = "",
}: InteractiveParticlesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  // Latest props for the loop without re-initializing the simulation.
  // Synced in an effect (never mutated during render) — the rAF loop reads
  // it per frame, so prop changes apply from the next painted frame on.
  const settings = useRef({ density, speed, interactive });
  useEffect(() => {
    settings.current = { density, speed, interactive };
  }, [density, speed, interactive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const teardownFns: Array<() => void> = [];
    let disposed = false;
    const teardown = () => {
      disposed = true;
      for (const fn of teardownFns) fn();
    };

    /**
     * Flip to the fallback node. Deferred (not synchronously inside the
     * effect): failure is an external-system outcome and the state change
     * must not trigger a cascading render mid-effect.
     */
    const failToFallback = (reason: unknown) => {
      console.error(
        "InteractiveParticles: canvas init failed, rendering fallback.",
        reason,
      );
      window.setTimeout(() => {
        if (!disposed) setFailed(true);
      }, 0);
    };

    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        failToFallback(new Error("canvas.getContext('2d') returned null"));
        return;
      }

      // ── Capability / mode detection ────────────────────────────────
      const mobileMq = window.matchMedia("(max-width: 767px), (pointer: coarse)");
      const fineMq = window.matchMedia("(pointer: fine)");
      const rmMq = window.matchMedia("(prefers-reduced-motion: reduce)");
      const isMobile = () =>
        typeof mobileMode === "boolean" ? mobileMode : mobileMq.matches;
      const reducedActive = () =>
        typeof reducedMotion === "boolean" ? reducedMotion : rmMq.matches;

      // ── Simulation state ───────────────────────────────────────────
      const particles: Particle[] = [];
      const bounds = { w: 0, h: 0 };
      const pointer = { x: -9999, y: -9999, active: false };
      let raf = 0;
      let last = performance.now();
      let documentHidden = document.hidden;
      let inView = false;

      const spawn = (): Particle => {
        const angle = Math.random() * TAU;
        const magnitude = DRIFT_MIN + Math.random() * (DRIFT_MAX - DRIFT_MIN);
        const bx = Math.cos(angle) * magnitude;
        const by = Math.sin(angle) * magnitude;
        return {
          x: Math.random() * Math.max(bounds.w, 1),
          y: Math.random() * Math.max(bounds.h, 1),
          bx,
          by,
          vx: bx,
          vy: by,
          r: 1 + Math.random() * 1.5,
          accent: Math.random() < ACCENT_RATIO,
        };
      };

      /** Target count: density on desktop, ~40% (min 18) in low-power mode. */
      const targetCount = () => {
        const base = Math.max(1, Math.round(settings.current.density));
        return isMobile()
          ? Math.max(18, Math.round(base * MOBILE_DENSITY))
          : base;
      };

      /** Grow/shrink the particle set to the current target count. */
      const syncCount = () => {
        const target = targetCount();
        while (particles.length < target) particles.push(spawn());
        if (particles.length > target) particles.length = target;
      };

      /** Even, jittered-grid distribution — used for the static frame. */
      const seedEven = (count: number) => {
        particles.length = 0;
        const { w, h } = bounds;
        if (count <= 0 || w <= 1 || h <= 1) return;
        const cols = Math.max(1, Math.round(Math.sqrt(count * (w / h))));
        const rows = Math.max(1, Math.ceil(count / cols));
        const cw = w / cols;
        const ch = h / rows;
        let placed = 0;
        for (let row = 0; row < rows && placed < count; row++) {
          for (let col = 0; col < cols && placed < count; col++) {
            const p = spawn();
            p.x = clamp((col + 0.5) * cw + (Math.random() - 0.5) * cw * 0.5, 1, w - 1);
            p.y = clamp((row + 0.5) * ch + (Math.random() - 0.5) * ch * 0.5, 1, h - 1);
            particles.push(p);
            placed++;
          }
        }
      };

      // ── Draw: faint links + warm node dots ─────────────────────────
      const draw = () => {
        const linkDist = isMobile()
          ? CONNECT_DISTANCE_LOW_POWER
          : CONNECT_DISTANCE;
        const linkDist2 = linkDist * linkDist;

        ctx.clearRect(0, 0, bounds.w, bounds.h);

        // One batched path for all links (single stroke).
        ctx.lineWidth = 1;
        ctx.strokeStyle = LINK_COLOR;
        ctx.beginPath();
        for (let i = 0; i < particles.length; i++) {
          const a = particles[i];
          for (let j = i + 1; j < particles.length; j++) {
            const b = particles[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            if (dx * dx + dy * dy < linkDist2) {
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
            }
          }
        }
        ctx.stroke();

        for (const p of particles) {
          ctx.beginPath();
          ctx.fillStyle = p.accent ? ACCENT_COLOR : NODE_COLOR;
          ctx.arc(p.x, p.y, p.r, 0, TAU);
          ctx.fill();
        }
      };

      /** One evenly-distributed static frame; no loop, no pointer listeners. */
      const drawStatic = () => {
        seedEven(targetCount());
        draw();
      };

      // ── Update: drift + gentle, damped pointer attraction ──────────
      const update = (dt: number) => {
        const s = settings.current;
        const speedMult = clamp(s.speed, 0.25, 3);
        const max = MAX_SPEED * speedMult;
        const attract =
          s.interactive && !isMobile() && fineMq.matches && pointer.active;
        const relax = 1 - Math.exp(-dt * RELAX_RATE);

        for (const p of particles) {
          if (attract) {
            const dx = pointer.x - p.x;
            const dy = pointer.y - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < POINTER_RADIUS * POINTER_RADIUS && d2 > 0.0001) {
              const d = Math.sqrt(d2);
              const accel = ATTRACT_ACCEL * (1 - d / POINTER_RADIUS) * speedMult;
              p.vx += (dx / d) * accel * dt;
              p.vy += (dy / d) * accel * dt;
            }
          }
          // Damped relaxation toward base drift keeps interaction subtle.
          p.vx += (p.bx * speedMult - p.vx) * relax;
          p.vy += (p.by * speedMult - p.vy) * relax;
          const sp = Math.hypot(p.vx, p.vy);
          if (sp > max) {
            p.vx = (p.vx / sp) * max;
            p.vy = (p.vy / sp) * max;
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          // Velocity wrap-around at the edges.
          if (p.x < 0) p.x += bounds.w;
          else if (p.x > bounds.w) p.x -= bounds.w;
          if (p.y < 0) p.y += bounds.h;
          else if (p.y > bounds.h) p.y -= bounds.h;
        }
      };

      // ── Sizing (DPR-capped, container-driven — never fixed 100vh) ──
      const resize = () => {
        if (disposed) return;
        const dpr = Math.min(
          window.devicePixelRatio || 1,
          isMobile() ? 1.5 : DPR_CAP,
        );
        const w = Math.max(1, container.clientWidth);
        const h = Math.max(1, container.clientHeight);
        const pw = Math.round(w * dpr);
        const ph = Math.round(h * dpr);
        const sizeChanged = canvas.width !== pw || canvas.height !== ph;
        if (sizeChanged) {
          canvas.width = pw;
          canvas.height = ph;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px
        bounds.w = w;
        bounds.h = h;
        syncCount();
        if (sizeChanged && reducedActive()) {
          drawStatic(); // keep the static frame evenly distributed + crisp
        }
      };

      // ── Pointer interaction (record only; forces apply in update) ──
      const onPointerMove = (e: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        pointer.x = e.clientX - rect.left;
        pointer.y = e.clientY - rect.top;
        pointer.active = true;
      };
      const onPointerLeave = () => {
        pointer.active = false;
        pointer.x = -9999;
        pointer.y = -9999;
      };
      const setupInteractions = () => {
        container.addEventListener("pointermove", onPointerMove);
        container.addEventListener("pointerleave", onPointerLeave);
      };
      const teardownInteractions = () => {
        container.removeEventListener("pointermove", onPointerMove);
        container.removeEventListener("pointerleave", onPointerLeave);
        onPointerLeave();
      };

      // ── Loop lifecycle: stops when hidden or offscreen ─────────────
      const step = (now: number) => {
        raf = 0;
        if (disposed) return;
        if (documentHidden || !inView || reducedActive()) {
          return; // loop stops; visibility/intersection events resume it
        }
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        update(dt);
        draw();
        raf = requestAnimationFrame(step);
      };
      const startLoop = () => {
        if (disposed || raf !== 0) return;
        if (documentHidden || !inView || reducedActive()) return;
        last = performance.now(); // avoid a dt spike after pauses
        raf = requestAnimationFrame(step);
      };
      const stopLoop = () => {
        if (raf !== 0) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      };

      // ── Listeners / observers (all torn down on unmount) ───────────
      const onVisibility = () => {
        documentHidden = document.hidden;
        if (documentHidden) stopLoop();
        else startLoop();
      };
      document.addEventListener("visibilitychange", onVisibility);
      teardownFns.push(() =>
        document.removeEventListener("visibilitychange", onVisibility),
      );

      const io = new IntersectionObserver(
        ([entry]) => {
          inView = entry.isIntersecting;
          if (inView) startLoop();
          else stopLoop();
        },
        { threshold: 0.01 },
      );
      io.observe(container);
      teardownFns.push(() => io.disconnect());

      const ro = new ResizeObserver(resize);
      ro.observe(container);
      teardownFns.push(() => ro.disconnect());

      const onWindowResize = () => resize();
      window.addEventListener("resize", onWindowResize);
      teardownFns.push(() => window.removeEventListener("resize", onWindowResize));

      const onMobileChange = () => resize(); // re-evaluates DPR + density
      mobileMq.addEventListener("change", onMobileChange);
      teardownFns.push(() =>
        mobileMq.removeEventListener("change", onMobileChange),
      );

      const onReducedChange = () => {
        if (reducedActive()) {
          stopLoop();
          teardownInteractions();
          drawStatic();
        } else {
          setupInteractions();
          startLoop();
        }
      };
      rmMq.addEventListener("change", onReducedChange);
      teardownFns.push(() => rmMq.removeEventListener("change", onReducedChange));

      // ── Initial state ──────────────────────────────────────────────
      resize(); // sizes the canvas and seeds the field
      if (reducedActive()) {
        drawStatic();
      } else {
        setupInteractions(); // update() still guards interactive/mobile state
        draw(); // first paint before the IntersectionObserver callback lands
      }

      return teardown;
    } catch (err) {
      teardown();
      failToFallback(err);
    }
  }, [density, mobileMode, reducedMotion]);

  // ── Fallback rendering (no 2D context / init threw) ──────────────────
  if (failed) {
    if (fallback) {
      return (
        <div
          ref={containerRef}
          className={`overflow-hidden ${className}`}
          style={{ position: "relative" }}
        >
          {fallback}
        </div>
      );
    }
    return (
      <div
        ref={containerRef}
        className={`overflow-hidden ${className}`}
        data-particles-fallback="css"
        style={{
          position: "relative",
          background:
            "radial-gradient(90% 70% at 28% 22%, rgba(217, 142, 74, 0.10), transparent 60%)," +
            "radial-gradient(85% 70% at 76% 80%, rgba(214, 209, 200, 0.06), transparent 65%)",
        }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden ${className}`}
      aria-hidden
      style={{ position: "relative" }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 block h-full w-full"
      />
    </div>
  );
}
