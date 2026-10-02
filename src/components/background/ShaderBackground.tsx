"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type ShaderMode =
  | "rust-mesh"
  | "noir-mesh"
  | "neural-flow"
  | "graph-field"
  | "deep-space"
  | "minimal";

export const SHADER_MODES: { value: ShaderMode; label: string }[] = [
  { value: "rust-mesh", label: "Rust Mesh" },
  { value: "noir-mesh", label: "Noir Mesh" },
  { value: "neural-flow", label: "Neural Flow" },
  { value: "graph-field", label: "Graph Field" },
  { value: "deep-space", label: "Deep Space" },
  { value: "minimal", label: "Minimal" },
];

export interface ShaderBackgroundProps {
  mode?: ShaderMode;
  /** Time multiplier (0.25 – 3). */
  speed?: number;
  /** Pattern strength multiplier (0.25 – 2). */
  intensity?: number;
  /** Output opacity (0 – 1). */
  opacity?: number;
  /** Film-grain overlay (shader-side when WebGL is active). */
  grain?: boolean;
  /** Parallax the pattern toward the pointer (pointer-fine devices only). */
  mouseInteraction?: boolean;
  /** `true` forces low-power mode; `auto` detects coarse pointers / narrow viewports. */
  mobileMode?: boolean | "auto";
  /** `true` renders a single static frame; `auto` follows prefers-reduced-motion. */
  reducedMotion?: boolean | "auto";
  /** Custom non-WebGL fallback node. Defaults to the built-in CSS gradient. */
  fallback?: ReactNode;
  className?: string;
}

const VERTEX_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT_SRC = `
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_mouse;
uniform float u_intensity;
uniform float u_grain;
uniform float u_mode;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0; float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.7, 9.2);
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag * 2.0 - u_res) / min(u_res.x, u_res.y);
  float t = u_time;
  vec2 m = u_mouse * 0.18;
  vec3 col = vec3(0.0);
  int mode = int(u_mode + 0.5);

  if (mode == 0) {
    // Rust Mesh — domain-warped fbm, rust/copper on warm near-black
    vec2 p = uv * 1.35 + m;
    float q = fbm(p + vec2(t * 0.055, -t * 0.038));
    float r = fbm(p * 1.15 + q * 1.9 + vec2(-t * 0.042, t * 0.05));
    float v = r * u_intensity;
    col = mix(vec3(0.043, 0.037, 0.034), vec3(0.541, 0.204, 0.055), smoothstep(0.30, 0.80, v));
    col = mix(col, vec3(0.784, 0.475, 0.255), smoothstep(0.74, 0.96, v) * 0.8);
  } else if (mode == 1) {
    // Noir Mesh — graphite monochrome
    vec2 p = uv * 1.35 + m;
    float q = fbm(p + vec2(t * 0.045, t * 0.03));
    float r = fbm(p * 1.2 + q * 1.7 + vec2(t * 0.03, -t * 0.036));
    float v = r * u_intensity;
    col = mix(vec3(0.035, 0.035, 0.037), vec3(0.150, 0.150, 0.158), smoothstep(0.25, 0.85, v));
    col = mix(col, vec3(0.290, 0.285, 0.285), smoothstep(0.78, 0.97, v) * 0.7);
  } else if (mode == 2) {
    // Neural Flow — warped ember filaments
    float w = fbm(uv * 1.6 + vec2(t * 0.06, t * 0.045) + m * 0.6);
    float bands = sin((uv.x * 4.0 + w * 5.0 + t * 0.22) * 3.14159);
    float line = pow(abs(bands), 38.0);
    float glow = pow(0.5 + 0.5 * sin((uv.y * 3.0 - t * 0.12) + w * 4.0), 6.0);
    col = vec3(0.030, 0.027, 0.025);
    col += vec3(0.784, 0.475, 0.255) * line * 0.55 * u_intensity;
    col += vec3(0.541, 0.204, 0.055) * glow * 0.16 * u_intensity;
  } else if (mode == 3) {
    // Graph Field — graphite grid, copper pulse nodes
    vec2 p = uv * 3.0 + m * 0.5 + vec2(fbm(uv * 2.0 + t * 0.03)) * 0.6;
    vec2 g = fract(p);
    vec2 id = floor(p);
    vec2 gv = abs(g - 0.5);
    float line = smoothstep(0.46, 0.5, max(gv.x, gv.y));
    float node = hash(id);
    float pulse = 0.5 + 0.5 * sin(t * 0.8 + node * 6.2831);
    float dotm = smoothstep(0.14, 0.02, length(g - 0.5)) * step(0.82, node);
    col = vec3(0.033, 0.031, 0.030);
    col += vec3(0.55, 0.55, 0.56) * line * 0.10 * u_intensity;
    col += vec3(0.784, 0.475, 0.255) * dotm * (0.35 + 0.65 * pulse) * u_intensity;
  } else if (mode == 4) {
    // Deep Space — faint warm nebula + sparse twinkling stars
    vec2 p = uv * 1.2 + m;
    float neb = fbm(p + vec2(t * 0.012, -t * 0.009));
    col = vec3(0.024, 0.022, 0.021);
    col += vec3(0.30, 0.16, 0.09) * neb * neb * 0.55 * u_intensity;
    vec2 sp = uv * 14.0;
    vec2 cell = floor(sp);
    float h = hash(cell);
    if (h > 0.985) {
      float tw = 0.5 + 0.5 * sin(t * (0.5 + h * 2.0) + h * 40.0);
      float d = length(fract(sp) - 0.5);
      col += vec3(0.9, 0.75, 0.6) * smoothstep(0.12, 0.0, d) * tw;
    }
  } else {
    // Minimal — barely-visible slow warm drift
    float d = length(uv);
    float v = fbm(vec2(d * 1.1 - t * 0.03, t * 0.015) + m * 0.3);
    col = vec3(0.038, 0.035, 0.033)
        + vec3(0.10, 0.055, 0.035) * smoothstep(0.4, 0.9, v) * u_intensity;
  }

  float gn = hash(frag + fract(t) * vec2(13.7, 7.3));
  col += (gn - 0.5) * u_grain * 0.10;
  col = max(col, vec3(0.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

const GRAIN_DATA_URI =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='0.55'/></svg>\")";

const MODE_INDEX: Record<ShaderMode, number> = {
  "rust-mesh": 0,
  "noir-mesh": 1,
  "neural-flow": 2,
  "graph-field": 3,
  "deep-space": 4,
  minimal: 5,
};

/**
 * ShaderBackground — Scrolltide-style low-frequency GPU background.
 *
 * Guarantees:
 * - No WebGL (or context loss) → CSS gradient fallback; the page never breaks.
 * - Never blocks the UI thread: all animation is GPU + rAF; pointer handlers
 *   only record coordinates.
 * - Pauses rendering when the tab is hidden or the canvas is offscreen.
 * - Reduced motion renders a single static frame (texture visible, no loop).
 * - DPR ≤ 1.5 (≤ 1.0 + 0.75× resolution in mobile mode) per performance budget.
 */
export function ShaderBackground({
  mode = "rust-mesh",
  speed = 1,
  intensity = 1,
  opacity = 1,
  grain = true,
  mouseInteraction = true,
  mobileMode = "auto",
  reducedMotion = "auto",
  fallback,
  className = "",
}: ShaderBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  // Latest props for the render loop without GL re-initialization.
  const settings = useRef({ mode, speed, intensity, opacity, grain });
  settings.current = { mode, speed, intensity, opacity, grain };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const gl = (canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    }) ?? canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) {
      setFailed(true);
      return;
    }

    // ── Program setup ────────────────────────────────────────────────
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("ShaderBackground compile error:", gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vs || !fs) {
      setFailed(true);
      return;
    }
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("ShaderBackground link error:", gl.getProgramInfoLog(program));
      setFailed(true);
      return;
    }
    gl.useProgram(program);

    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uMouse = gl.getUniformLocation(program, "u_mouse");
    const uIntensity = gl.getUniformLocation(program, "u_intensity");
    const uGrain = gl.getUniformLocation(program, "u_grain");
    const uMode = gl.getUniformLocation(program, "u_mode");

    // ── Sizing (DPR-capped) ──────────────────────────────────────────
    const mobileMq = window.matchMedia("(max-width: 767px), (pointer: coarse)");
    const isMobile = () =>
      typeof mobileMode === "boolean" ? mobileMode : mobileMq.matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, isMobile() ? 1.0 : 1.5);
      const scale = isMobile() ? 0.75 : 1;
      const w = Math.max(1, Math.round(container.clientWidth * dpr * scale));
      const h = Math.max(1, Math.round(container.clientHeight * dpr * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // ── Lifecycle flags ──────────────────────────────────────────────
    let hidden = document.hidden;
    let inView = true;
    let disposed = false;
    let time = 0;
    let last = performance.now();
    let staticDrawn = false;

    const onVisibility = () => {
      hidden = document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibility);

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
      },
      { threshold: 0.01 },
    );
    io.observe(container);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    // ── Reduced motion resolution ────────────────────────────────────
    const rmMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reducedActive = () =>
      typeof reducedMotion === "boolean" ? reducedMotion : rmMq.matches;

    // ── Mouse (record only; smoothing happens in the frame loop) ─────
    const mouseTarget = { x: 0.5, y: 0.5 };
    const mouseSmooth = { x: 0.5, y: 0.5 };
    const onPointerMove = (e: PointerEvent) => {
      if (!mouseInteraction || isMobile()) return;
      const rect = container.getBoundingClientRect();
      mouseTarget.x = (e.clientX - rect.left) / Math.max(rect.width, 1);
      mouseTarget.y = 1 - (e.clientY - rect.top) / Math.max(rect.height, 1);
    };
    const onPointerLeave = () => {
      mouseTarget.x = 0.5;
      mouseTarget.y = 0.5;
    };
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);

    // ── Frame loop ───────────────────────────────────────────────────
    let raf = 0;
    const frame = (now: number) => {
      if (disposed) return;
      const dt = Math.min(now - last, 100);
      last = now;

      const s = settings.current;
      const reduced = reducedActive();

      if (!hidden && inView) {
        const shouldAnimate = !reduced;
        if (shouldAnimate) {
          time += (dt / 1000) * Math.min(Math.max(s.speed, 0.05), 4);
          staticDrawn = false;
        }

        if (shouldAnimate || !staticDrawn) {
          // Smooth the mouse toward its target (damped parallax).
          mouseSmooth.x += (mouseTarget.x - mouseSmooth.x) * 0.06;
          mouseSmooth.y += (mouseTarget.y - mouseSmooth.y) * 0.06;

          gl.uniform2f(uRes, canvas.width, canvas.height);
          gl.uniform1f(uTime, time + 9.0); // offset avoids the t≈0 flat start
          gl.uniform2f(uMouse, mouseSmooth.x - 0.5, mouseSmooth.y - 0.5);
          gl.uniform1f(uIntensity, Math.min(Math.max(s.intensity, 0.1), 2));
          gl.uniform1f(uGrain, s.grain ? 1 : 0);
          gl.uniform1f(uMode, MODE_INDEX[s.mode]);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          if (!shouldAnimate) staticDrawn = true;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // ── Cleanup ──────────────────────────────────────────────────────
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [mobileMode, reducedMotion, mouseInteraction]);

  // ── Fallback rendering (no WebGL / context lost) ───────────────────
  if (failed) {
    if (fallback) {
      return (
        <div
          ref={containerRef}
          className={`overflow-hidden ${className}`}
          style={{ position: "relative" }}
          aria-hidden
        >
          {fallback}
        </div>
      );
    }
    return (
      <div
        ref={containerRef}
        className={`overflow-hidden ${className}`}
        aria-hidden
        data-shader-fallback="css"
        style={{
          position: "relative",
          background:
            "radial-gradient(120% 90% at 20% 10%, rgba(138,52,19,0.28), transparent 55%)," +
            "radial-gradient(100% 80% at 85% 85%, rgba(200,121,65,0.16), transparent 60%)," +
            "linear-gradient(160deg, #0d0b0a 0%, #121010 55%, #0c0b0a 100%)",
        }}
      >
        {grain ? (
          <div
            className="absolute inset-0"
            style={{ backgroundImage: GRAIN_DATA_URI, opacity: 0.05 }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden ${className}`}
      style={{ position: "relative" }}
      aria-hidden
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      {/* Edge blend: keeps content dominant and hides canvas edges */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_40%,transparent_60%,rgba(0,0,0,0.35)_100%)]" />
    </div>
  );
}
