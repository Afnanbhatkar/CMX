"use client";

import { useState } from "react";

import {
  SHADER_MODES,
  ShaderBackground,
  type ShaderMode,
} from "@/components/background/ShaderBackground";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

export function ShaderLab() {
  const [mode, setMode] = useState<ShaderMode>("rust-mesh");
  const [speed, setSpeed] = useState(1);
  const [intensity, setIntensity] = useState(1);
  const [opacity, setOpacity] = useState(0.95);
  const [grain, setGrain] = useState(true);
  const [mouse, setMouse] = useState(true);
  const [mobileMode, setMobileMode] = useState(false);
  const [reducedMotion, setReducedMotion] = useState<"auto" | boolean>("auto");

  return (
    <section id="shader" aria-labelledby="shader-heading" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Shader engine
      </p>
      <h2 id="shader-heading" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
        Scrolltide-style GPU background — configurable, fallback-safe
      </h2>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        Low-frequency organic movement, subtle grain, damped pointer parallax.
        Rendering pauses when the tab is hidden or the canvas leaves the
        viewport; without WebGL it degrades to a static CSS gradient — the page
        never breaks.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        {/* Controls */}
        <div className="space-y-6 rounded-lg border border-subtle bg-surface p-4 sm:p-5">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Mode</Label>
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Shader mode">
              {SHADER_MODES.map((m) => (
                <Button
                  key={m.value}
                  size="sm"
                  variant={mode === m.value ? "default" : "outline"}
                  aria-pressed={mode === m.value}
                  onClick={() => setMode(m.value)}
                  className="h-8 px-2.5 font-mono text-xs"
                >
                  {m.label}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Active: <Badge variant="secondary" className="font-mono text-[10px]">{mode}</Badge>
            </p>
          </div>

          <div>
            <div className="flex justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Speed</Label>
              <span className="font-mono text-xs text-foreground/80">{speed.toFixed(2)}×</span>
            </div>
            <Slider
              className="mt-2"
              value={[speed]}
              onValueChange={([v]) => setSpeed(v)}
              min={0.25}
              max={3}
              step={0.05}
              aria-label="Shader speed"
            />
          </div>

          <div>
            <div className="flex justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Intensity</Label>
              <span className="font-mono text-xs text-foreground/80">{intensity.toFixed(2)}×</span>
            </div>
            <Slider
              className="mt-2"
              value={[intensity]}
              onValueChange={([v]) => setIntensity(v)}
              min={0.25}
              max={2}
              step={0.05}
              aria-label="Shader intensity"
            />
          </div>

          <div>
            <div className="flex justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Opacity</Label>
              <span className="font-mono text-xs text-foreground/80">{opacity.toFixed(2)}</span>
            </div>
            <Slider
              className="mt-2"
              value={[opacity]}
              onValueChange={([v]) => setOpacity(v)}
              min={0.2}
              max={1}
              step={0.05}
              aria-label="Shader opacity"
            />
          </div>

          <div className="space-y-3">
            <label className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Grain</span>
              <Switch checked={grain} onCheckedChange={setGrain} aria-label="Toggle grain" />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Mouse interaction</span>
              <Switch checked={mouse} onCheckedChange={setMouse} aria-label="Toggle mouse interaction" />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Mobile mode (low-power)</span>
              <Switch checked={mobileMode} onCheckedChange={setMobileMode} aria-label="Toggle mobile mode" />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Reduced motion</span>
              <Switch
                checked={reducedMotion === true}
                onCheckedChange={(v) => setReducedMotion(v)}
                aria-label="Toggle reduced motion"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              When off, the shader still honors the OS
              <span className="font-mono"> prefers-reduced-motion </span>
              setting automatically.
            </p>
          </div>
        </div>

        {/* Preview */}
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border border-subtle">
            <ShaderBackground
              mode={mode}
              speed={speed}
              intensity={intensity}
              opacity={opacity}
              grain={grain}
              mouseInteraction={mouse}
              mobileMode={mobileMode}
              reducedMotion={reducedMotion}
              className="h-72 w-full sm:h-96 lg:h-[420px]"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              mode: <span className="font-mono text-foreground/80">{mode}</span>
            </span>
            <span>WebGL → CSS-gradient fallback · DPR ≤ 1.5 · pauses offscreen</span>
          </div>
        </div>
      </div>
    </section>
  );
}
