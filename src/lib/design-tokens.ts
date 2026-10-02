/**
 * CodeMind X V2 — Design tokens (Phase 1)
 *
 * TypeScript mirror of the CSS custom properties declared in
 * `src/app/globals.css`. Motion values are in **seconds** (Framer Motion
 * convention). Never scatter magic values through the app — import from here.
 */

/* ── Motion duration (seconds) ──────────────────────────────────────── */
export const motionDuration = {
  fast: 0.15, // micro-feedback: hover, caret blink
  base: 0.24, // standard transitions: fade, slide
  slow: 0.42, // large surfaces: panels, hero reveals
} as const;

/* ── Motion easing ──────────────────────────────────────────────────── */
export const motionEase = {
  /** Soft deceleration — the CodeMind signature ease. */
  outSoft: [0.22, 1, 0.36, 1],
  /** Symmetric — loops and position sweeps. */
  inOut: [0.65, 0, 0.35, 1],
  /** Linear — shimmer sweeps, aurora drift. */
  linear: [0, 0, 1, 1],
} as const;

/** Shared spring for panel/activity transitions. */
export const springSoft = { type: "spring", stiffness: 260, damping: 30 } as const;

/* ── Z-index scale ──────────────────────────────────────────────────── */
export const zIndex = {
  base: 0,
  raised: 10,
  sticky: 100,
  header: 200,
  overlay: 300,
  modal: 400,
  toast: 500,
  max: 999,
} as const;

/* ── Breakpoints (px, mirrors Tailwind defaults) ────────────────────── */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

/* ── Reference gradients (supplied design specifications) ───────────── */
/** AuroraText reference gradient — exact stops from the supplied spec. */
export const AURORA_GRADIENT = [
  "#ff4d8d",
  "#ff7a59",
  "#ffc857",
  "#4ade80",
  "#22d3ee",
  "#60a5fa",
  "#a78bfa",
  "#ff4d8d",
] as const;

/** Gradient sweep used by DiaTextReveal / GradientText (rust → copper → amber). */
export const SWEEP_GRADIENT = [
  "#8a3413",
  "#c87941",
  "#ffc857",
  "#c87941",
  "#8a3413",
] as const;

export type MotionDuration = keyof typeof motionDuration;
export type MotionEase = keyof typeof motionEase;
