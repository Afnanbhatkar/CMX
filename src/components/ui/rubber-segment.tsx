"use client";

/**
 * RubberSegment — segmented control with a rubber-band physics thumb.
 *
 * Vendored VERBATIM from the user-provided source (spring integrator,
 * stretch/squash/glide presets, draggable thumb, overlay-label technique,
 * keyboard + reduced-motion handling are all byte-identical).
 *
 * Only additive integration hooks were layered on top (they do not touch
 * the animation in any way):
 *  - `value?: string`          — controlled current item; when it changes
 *    OUTSIDE the control (e.g. Alt+1..4 / Alt+M shortcuts), the thumb
 *    animates to the new slot with the exact same rubber physics.
 *  - `itemTitles?: string[]`   — native `title` tooltip per slot.
 *  - `ariaLabel?: string`      — accessible name for the radiogroup.
 */

import * as React from "react";

const { useEffect, useLayoutEffect, useRef, useState } = React;
const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type RubberPreset = "periods" | "snappy" | "jelly" | "smooth";

const PRESETS: Record<RubberPreset, { stretch: number; squash: number; speed: number; glide: number }> = {
  periods: { stretch: 100, squash: 3, speed: 1, glide: 75 },
  snappy: { stretch: 60, squash: 1, speed: 1.4, glide: 40 },
  jelly: { stretch: 160, squash: 6, speed: 0.9, glide: 90 },
  smooth: { stretch: 40, squash: 0, speed: 1, glide: 20 },
};

const SIZES = {
  sm: { h: 30, fs: 12, px: 12 },
  md: { h: 36, fs: 14, px: 16 },
  lg: { h: 44, fs: 16, px: 20 },
} as const;

const CSS = `
.rs-btn,.rs-lbl{display:flex;align-items:center;justify-content:center;border:0;background:none;margin:0;
  font:inherit;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer}
.rs-lbl{cursor:default}
.rs-btn:focus-visible{outline:2px solid #7aa2ff;outline-offset:2px}
.rs-btn:disabled{cursor:not-allowed}`;

function ensureCss() {
  if (typeof document === "undefined" || document.getElementById("rs-css")) return;
  const s = document.createElement("style");
  s.id = "rs-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface RubberSegmentProps {
  items: string[];
  defaultValue?: string;
  onChange?: (value: string, index: number) => void;
  trackColor?: string;
  thumbColor?: string;
  textColor?: string;
  activeTextColor?: string;
  size?: "sm" | "md" | "lg";
  /** Track corner radius in px. The thumb uses radius - inset. */
  radius?: number;
  /** Gap between track edge and thumb in px. */
  inset?: number;
  /** Equal-width slots (true) or content-width slots (false). */
  equalSlots?: boolean;
  /** Rubber elongation while moving, 0 to 200 (percent). */
  stretch?: number;
  /** Max vertical squash of the thumb at full stretch, in px. */
  squash?: number;
  /** Animation speed multiplier. */
  speed?: number;
  /** Momentum / overshoot, 0 to 100. Higher glides and settles with more bounce. */
  glide?: number;
  /** Drag the thumb with the pointer; it snaps to the nearest slot on release. */
  draggable?: boolean;
  /** Default values for stretch, squash, speed and glide. Explicit props win. */
  preset?: RubberPreset;
  disabled?: boolean;
  className?: string;
  /** Integration addition: controlled current item (animated external sync). */
  value?: string;
  /** Integration addition: native `title` tooltip per slot. */
  itemTitles?: string[];
  /** Integration addition: accessible name for the radiogroup. */
  ariaLabel?: string;
}

export default function RubberSegment(props: RubberSegmentProps) {
  const {
    items, defaultValue, onChange,
    trackColor = "#27272a", thumbColor = "#fafafa", textColor = "#fafafa", activeTextColor = "#18181b",
    size = "md", radius = 10, inset = 3, equalSlots = true, draggable = true,
    preset = "periods", disabled = false, className, value, itemTitles, ariaLabel,
  } = props;

  const base = PRESETS[preset] ?? PRESETS.periods;
  const stretch = props.stretch ?? base.stretch;
  const squash = props.squash ?? base.squash;
  const speed = props.speed ?? base.speed;
  const glide = props.glide ?? base.glide;
  const S = SIZES[size] ?? SIZES.md;

  const [index, setIndex] = useState(() => Math.max(0, items.indexOf(defaultValue ?? items[0])));
  const idxRef = useRef(index);
  idxRef.current = index;

  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const ovRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const simRef = useRef({
    L: 0, R: 0, vL: 0, vR: 0, tL: 0, tR: 0, raf: 0, last: 0,
    pending: false, drag: false, suppress: false, startX: 0, grab: 0,
  });
  const cfgRef = useRef({ stretch, squash, speed, glide, inset });
  cfgRef.current = { stretch, squash, speed, glide, inset };

  const apply = () => {
    const s = simRef.current, c = cfgRef.current;
    const th = thumbRef.current, ov = ovRef.current, tr = trackRef.current;
    if (!th || !ov || !tr) return;
    const baseW = Math.max(1, s.tR - s.tL);
    const w = Math.max(baseW * 0.4, s.R - s.L);
    const grow = Math.max(0, w / baseW - 1);
    const H = th.offsetHeight || 1;
    const sy = 1 - (c.squash * Math.min(1.5, grow * 2.5)) / H;
    th.style.width = `${w}px`;
    th.style.transform = `translateX(${s.L}px) scaleY(${sy})`;
    ov.style.width = `${tr.clientWidth}px`;
    ov.style.transform = `translate(${-s.L}px, ${-c.inset}px)`;   // keeps the active-colored labels aligned under the thumb
  };

  const setTargets = (i: number) => {
    const b = slotsRef.current[i];
    if (!b) return;
    simRef.current.tL = b.offsetLeft;
    simRef.current.tR = b.offsetLeft + b.offsetWidth;
  };

  const snap = () => {
    const s = simRef.current;
    s.L = s.tL; s.R = s.tR; s.vL = s.vR = 0;
    apply();
  };

  const step = (now: number) => {
    const s = simRef.current, c = cfgRef.current;
    const dt = Math.min(0.05, (now - s.last) / 1000);
    s.last = now;
    const dir = Math.sign((s.tL + s.tR) / 2 - (s.L + s.R) / 2);
    const omega = 14 * c.speed;
    const zeta = 1 - 0.55 * (c.glide / 100);                 // 1 (no bounce) to 0.45 (bouncy)
    const ratio = 1 / (1 + (c.stretch / 100) * 1.4);          // trailing edge is softer: this is the rubber stretch
    const kL = omega * omega * (dir > 0 ? ratio : 1);
    const kR = omega * omega * (dir < 0 ? ratio : 1);
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) {
      s.vL += (kL * (s.tL - s.L) - 2 * zeta * Math.sqrt(kL) * s.vL) * h;
      s.vR += (kR * (s.tR - s.R) - 2 * zeta * Math.sqrt(kR) * s.vR) * h;
      s.L += s.vL * h;
      s.R += s.vR * h;
    }
    const settled =
      Math.abs(s.tL - s.L) < 0.05 && Math.abs(s.tR - s.R) < 0.05 && Math.abs(s.vL) < 0.05 && Math.abs(s.vR) < 0.05;
    if (settled && !s.drag) { snap(); s.raf = 0; return; }
    apply();
    s.raf = requestAnimationFrame(step);
  };

  const kick = () => {
    const s = simRef.current;
    if (reducedMotion()) { snap(); return; }
    if (!s.raf) { s.last = performance.now(); s.raf = requestAnimationFrame(step); }
  };

  const select = (i: number) => {
    if (disabled || i < 0 || i >= items.length) return;
    setTargets(i);
    kick();
    if (i !== idxRef.current) {
      idxRef.current = i;
      setIndex(i);
      onChange?.(items[i], i);
    }
  };

  useIso(() => {
    ensureCss();
    const tr = trackRef.current;
    if (!tr) return;
    const measure = () => { setTargets(idxRef.current); snap(); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(tr);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(simRef.current.raf);
      simRef.current.raf = 0;
    };
  }, [items.join("|"), equalSlots, size, inset]);

  /* Integration addition: sync the thumb with a controlled `value` that
     changed OUTSIDE this control (keyboard shortcuts, store resets). The
     thumb animates to the new slot with the same rubber physics — clicks
     remain fully in control of the component (no feedback loops: the sync
     no-ops when the value already matches the internal index). */
  const itemsKey = items.join("|");
  useEffect(() => {
    if (value === undefined) return;
    const next = items.findIndex((it) => it === value);
    if (next < 0 || next === idxRef.current) return;
    idxRef.current = next;
    setIndex(next);
    setTargets(next);
    kick();
  }, [value, itemsKey]);

  const nearest = (center: number) => {
    let best = 0, bd = Infinity;
    slotsRef.current.forEach((b, i) => {
      if (!b) return;
      const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - center);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || !draggable || e.button !== 0 || !trackRef.current) return;
    const s = simRef.current;
    const x = e.clientX - trackRef.current.getBoundingClientRect().left;
    if (x < s.L || x > s.R) return;                           // drag starts on the thumb only
    s.pending = true; s.drag = false; s.startX = e.clientX;
    s.grab = x - (s.L + s.R) / 2;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = simRef.current, tr = trackRef.current;
    if (!s.pending || !tr) return;
    if (!s.drag && Math.abs(e.clientX - s.startX) > 3) {
      s.drag = true;
      tr.setPointerCapture(e.pointerId);
    }
    if (!s.drag) return;
    const first = slotsRef.current[0], last = slotsRef.current[items.length - 1], cur = slotsRef.current[idxRef.current];
    if (!first || !last || !cur) return;
    const w = cur.offsetWidth;
    const x = e.clientX - tr.getBoundingClientRect().left - s.grab;
    const minL = first.offsetLeft, maxR = last.offsetLeft + last.offsetWidth;
    s.tL = Math.min(Math.max(x - w / 2, minL), maxR - w);
    s.tR = s.tL + w;
    kick();
  };

  const endDrag = (e: React.PointerEvent, cancelled: boolean) => {
    const s = simRef.current, tr = trackRef.current;
    if (!s.pending) return;
    const wasDrag = s.drag;
    s.pending = false; s.drag = false;
    if (!wasDrag) return;                                      // plain click is handled by the button
    if (tr?.hasPointerCapture(e.pointerId)) tr.releasePointerCapture(e.pointerId);
    s.suppress = true;
    setTimeout(() => { s.suppress = false; }, 0);
    select(cancelled ? idxRef.current : nearest((s.tL + s.tR) / 2));
    setTargets(idxRef.current);
    kick();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    let n = idxRef.current;
    if (k === "ArrowRight" || k === "ArrowDown") n = Math.min(items.length - 1, n + 1);
    else if (k === "ArrowLeft" || k === "ArrowUp") n = Math.max(0, n - 1);
    else if (k === "Home") n = 0;
    else if (k === "End") n = items.length - 1;
    else return;
    e.preventDefault();
    select(n);
    slotsRef.current[n]?.focus();
  };

  const thumbRadius = Math.max(0, radius - inset);
  const cols = equalSlots ? "1fr" : "auto";

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={className}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
      onKeyDown={onKeyDown}
      style={{
        position: "relative", display: "inline-grid", gridAutoFlow: "column", gridAutoColumns: cols,
        padding: inset, borderRadius: radius, background: trackColor,
        opacity: disabled ? 0.5 : 1, userSelect: "none", touchAction: "pan-y",
      }}
    >
      {items.map((it, i) => (
        <button
          key={it}
          ref={(el) => { slotsRef.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          disabled={disabled}
          className="rs-btn"
          title={itemTitles?.[i]}
          onClick={() => { if (!simRef.current.suppress) select(i); }}
          style={{ height: S.h, padding: `0 ${S.px}px`, fontSize: S.fs, color: textColor, borderRadius: thumbRadius }}
        >
          {it}
        </button>
      ))}

      <div
        ref={thumbRef}
        aria-hidden="true"
        style={{
          position: "absolute", top: inset, bottom: inset, left: 0, width: 0,
          borderRadius: thumbRadius, background: thumbColor, overflow: "hidden",
          pointerEvents: "none", willChange: "transform,width", transformOrigin: "center",
        }}
      >
        <div
          ref={ovRef}
          style={{
            position: "absolute", left: 0, top: 0, display: "grid", gridAutoFlow: "column",
            gridAutoColumns: cols, padding: inset, boxSizing: "border-box",
          }}
        >
          {items.map((it) => (
            <span key={it} className="rs-lbl" style={{ height: S.h, padding: `0 ${S.px}px`, fontSize: S.fs, color: activeTextColor }}>
              {it}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
