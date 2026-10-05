"use client";

/**
 * CodeMind X V2 — Solving orb canvas engine.
 *
 * EXACT port of the supplied reference prototype ("CodeMind X: Activity
 * Chain Preview" → `/* Solving orb: exact canvas code ported from
 * thinking-orbs *\/` block): the same dot-sphere wireframe engine —
 * hashed layer moves, depth-sorted ink dots, the resolved preset for
 * state "solving", size 64 (speed 1.82 · count 0.35 · size 1.05):
 *
 *   OPTS = { latRings: 9, lonDensity: 24, moveCount: 14, rBase: 0.63,
 *            rDepth: 1.785, rActive: 0.315, inkFar: 0.62, inkSpan: 0.54,
 *            rsPow: 0.6, rMin: 0.3 }, SPEED = 1.82, SIZE = 64
 *
 * The math is ported 1:1 (identical constants, identical order of
 * operations) — only names are expanded for readability. The canvas host
 * component (SolvingOrb.tsx) drives it with the prototype's render loop:
 * DPR = min(2, devicePixelRatio), transform per frame, static frame at
 * t = 0.6 under prefers-reduced-motion, pause when hidden/offscreen.
 *
 * Theme: the app is dark-first (`:root` IS the dark palette in
 * globals.css); an explicit data-theme / .dark / .light on <html> wins,
 * matching the prototype's isDark() with the app's default preserved.
 */

/* ------------------------------------------------------------------ */
/* Exact prototype math (1:1 port)                                     */
/* ------------------------------------------------------------------ */

/** Prototype `tt` — clamp with a soft upper bound. */
function clampTo(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

/** Prototype `ct` — deterministic position hash (sin trick). */
function positionHash(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** Prototype `X` — yaw/pitch rotation + perspective projection factory. */
function makeProjection(
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  scale: number,
): (x: number, y: number, z: number) => [number, number, number] {
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  return (x: number, y: number, z: number) => {
    const rx = x * cosYaw + z * sinYaw;
    const rz = -x * sinYaw + z * cosYaw;
    const ry = y * cosPitch - rz * sinPitch;
    const rz2 = y * sinPitch + rz * cosPitch;
    return [cx + rx * scale, cy - ry * scale, rz2];
  };
}

interface OrbDot {
  x: number;
  y: number;
  z: number;
  r: number;
  white: number;
  active?: boolean;
}

/** Prototype `U` — depth-sorted ink dots (theme decides ink polarity). */
function drawDots(
  ctx: CanvasRenderingContext2D,
  dots: OrbDot[],
  isDark: boolean,
  minRadius = 0.3,
): void {
  dots.sort((a, b) => a.z - b.z);
  for (const dot of dots) {
    const alpha = clampTo(dot.active ?? 1, dot.active ? 0.92 : 0.72);
    if (alpha < 0.02) continue;
    const white = Math.min(1, Math.max(0, dot.white));
    const level = Math.round((isDark ? 1 - white : white) * 255);
    ctx.fillStyle = `rgba(${level},${level},${level},${alpha})`;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, Math.max(minRadius, dot.r), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Prototype `Z` — canvas-size radius scale. */
function sizeScale(size: number, power: number): number {
  return (size / 300) ** power;
}

interface MoveLayer {
  axis: 0 | 1 | 2;
  lo: number;
  hi: number;
  ang: number;
}

interface MoveWave {
  amount: number[];
  active: number;
}

/** Prototype `Lt` — the travelling layer-move wave (one sweep per cycle). */
function moveWave(time: number, count: number, gap: number, hold: number): MoveWave {
  const cycle = 2 * count * gap + hold;
  const phase = time % cycle;
  const amount = new Array<number>(count).fill(0);
  let active = -1;
  if (phase < 2 * count * gap) {
    const index = Math.floor(phase / gap);
    const progress = (phase - index * gap) / gap;
    const eased = 1 - (1 - Math.min(1, progress / 0.7)) ** 3;
    if (index < count) {
      for (let i = 0; i < index; i += 1) amount[i] = 1;
      amount[index] = eased;
      active = index;
    } else {
      const reverse = 2 * count - 1 - index;
      for (let i = 0; i < reverse; i += 1) amount[i] = 1;
      amount[reverse] = 1 - eased;
      active = reverse;
    }
  }
  return { amount, active };
}

/** Prototype `Tt` — rotate a point by every active layer move. */
function applyMoves(
  point: [number, number, number],
  layers: MoveLayer[],
  wave: MoveWave,
): [number, number, number, boolean] {
  let [x, y, z] = point;
  let isActive = false;
  for (let i = 0; i < layers.length; i += 1) {
    if (wave.amount[i] <= 0) continue;
    const layer = layers[i];
    const axisValue = layer.axis === 0 ? x : layer.axis === 1 ? y : z;
    if (axisValue < layer.lo || axisValue >= layer.hi) continue;
    if (i === wave.active) isActive = true;
    const angle = layer.ang * wave.amount[i];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    if (layer.axis === 0) {
      const ny = y * cos - z * sin;
      z = y * sin + z * cos;
      y = ny;
    } else if (layer.axis === 1) {
      const nx = x * cos + z * sin;
      z = -x * sin + z * cos;
      x = nx;
    } else {
      const nx = x * cos - y * sin;
      y = x * sin + y * cos;
      x = nx;
    }
  }
  return [x, y, z, isActive];
}

/** Prototype `Vt` — deterministic move layers from the position hash. */
function makeMoveLayers(count: number): MoveLayer[] {
  const layers: MoveLayer[] = [];
  for (let i = 0; i < count; i += 1) {
    const axis = Math.min(2, Math.floor(positionHash(i, 2.3) * 3)) as 0 | 1 | 2;
    const lo = -1 + 0.5 * Math.min(3, Math.floor(positionHash(i, 5.9) * 4));
    const direction = positionHash(i, 7.7) < 0.5 ? 1 : -1;
    layers.push({ axis, lo, hi: lo + 0.5, ang: (direction * Math.PI) / 2 });
  }
  return layers;
}

export interface OrbOptions {
  latRings: number;
  lonDensity: number;
  moveCount: number;
  rBase: number;
  rDepth: number;
  rActive: number;
  inkFar: number;
  inkSpan: number;
  rsPow: number;
  rMin: number;
}

/**
 * Prototype `tn` — one full orb frame: the dot-sphere sphere sweep.
 * Identical math and identical constants to the reference prototype.
 */
function drawOrbSphere(
  ctx: CanvasRenderingContext2D,
  size: number,
  time: number,
  isDark: boolean,
  opts: OrbOptions,
): void {
  const cx = size / 2;
  const cy = size / 2;
  const sphereRadius = (size / 2) * 0.82;
  const project = makeProjection(
    time * 0.55,
    0.35 + 0.1 * Math.sin(time * 0.9),
    cx,
    cy,
    sphereRadius,
  );
  const radiusScale = sizeScale(size, opts.rsPow);
  const moveCount = opts.moveCount;
  const layers = makeMoveLayers(moveCount);
  const wave = moveWave(time, moveCount, 0.42, 1.2);
  const dots: OrbDot[] = [];
  const rings = opts.latRings;
  const lonDensity = opts.lonDensity;

  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = -Math.PI / 2 + (ring / rings) * Math.PI;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const columns = Math.max(1, Math.round(Math.abs(cosPhi) * lonDensity));
    for (let column = 0; column < columns; column += 1) {
      const theta = (column / columns) * 2 * Math.PI;
      const [px, py, pz, isActive] = applyMoves(
        [cosPhi * Math.cos(theta), sinPhi, cosPhi * Math.sin(theta)],
        layers,
        wave,
      );
      const [sx, sy, sz] = project(px, py, pz);
      const depth = (sz + 1) / 2;
      dots.push({
        x: sx,
        y: sy,
        z: sz,
        r:
          (opts.rBase + opts.rDepth * depth + (isActive ? opts.rActive : 0)) *
          radiusScale,
        white: opts.inkFar - opts.inkSpan * depth - (isActive ? 0.14 : 0),
        active: isActive,
      });
    }
  }
  drawDots(ctx, dots, isDark, opts.rMin);
}

/* ------------------------------------------------------------------ */
/* Resolved preset — state "solving", size 64 (prototype constants)     */
/* ------------------------------------------------------------------ */

/** Resolved preset for state "solving", size 64 (prototype comment verbatim). */
export const SOLVING_ORB_OPTS: OrbOptions = {
  latRings: 9,
  lonDensity: 24,
  moveCount: 14,
  rBase: 0.63,
  rDepth: 1.785,
  rActive: 0.315,
  inkFar: 0.62,
  inkSpan: 0.54,
  rsPow: 0.6,
  rMin: 0.3,
};

/** Prototype SPEED for the solving preset. */
export const SOLVING_ORB_SPEED = 1.82;
/** Prototype backing-canvas size (rendered at 22px via CSS). */
export const SOLVING_ORB_SIZE = 64;

/**
 * Theme detection for the canvas (canvas pixels cannot use CSS vars).
 * Prototype's isDark() with the app's dark-first default preserved:
 * an explicit data-theme / .dark / .light on <html> wins; with no marker
 * the app palette is dark (globals.css `:root` IS the dark identity).
 */
export function isDarkTheme(): boolean {
  if (typeof document === "undefined") return true;
  const root = document.documentElement;
  const theme = root.dataset.theme;
  if (theme === "dark") return true;
  if (theme === "light") return false;
  if (root.classList.contains("dark")) return true;
  if (root.classList.contains("light")) return false;
  return true;
}

/** Prototype render(): one frame at time `t` (seconds), DPR exact. */
export function renderSolvingOrbFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  time: number,
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const backing = Math.round(SOLVING_ORB_SIZE * dpr);
  if (canvas.width !== backing) {
    canvas.width = backing;
    canvas.height = backing;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SOLVING_ORB_SIZE, SOLVING_ORB_SIZE);
  drawOrbSphere(ctx, SOLVING_ORB_SIZE, time, isDarkTheme(), SOLVING_ORB_OPTS);
}
