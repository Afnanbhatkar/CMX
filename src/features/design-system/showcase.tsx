"use client";

import { ShaderBackground } from "@/components/background/ShaderBackground";
import {
  AuroraText,
  DiaTextReveal,
  FadeIn,
  SlideIn,
} from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MotionLab } from "@/features/design-system/motion-lab";
import { ShaderLab } from "@/features/design-system/shader-lab";
import { Braces } from "lucide-react";

/**
 * Phase 1 design-system showcase — the executable proof surface for the
 * token system, motion engine and shader engine. Content stays dominant;
 * the shader appears only in bounded, intentional regions.
 */
export function DesignSystemShowcase() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-subtle bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Braces className="h-4 w-4" aria-hidden />
            </span>
            <span className="font-mono text-sm font-semibold tracking-tight">
              CodeMind&nbsp;X
            </span>
            <Badge variant="outline" className="hidden font-mono text-[10px] sm:inline-flex">
              V2 · Phase 1
            </Badge>
          </div>
          <nav aria-label="Sections" className="flex items-center gap-1 text-sm">
            <Button variant="ghost" size="sm" asChild>
              <a href="#motion">Motion</a>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="#shader">Shader</a>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ──────────────────────────────────────────────────── */}
        <section
          aria-label="Introduction"
          className="relative overflow-hidden border-b border-subtle"
        >
          <div className="absolute inset-0">
            <ShaderBackground
              mode="rust-mesh"
              speed={0.85}
              intensity={0.9}
              opacity={0.9}
              className="h-full w-full"
            />
          </div>
          <div className="relative mx-auto w-full max-w-6xl px-4 py-24 sm:px-6 sm:py-32 md:py-40">
            <FadeIn>
              <Badge variant="outline" className="border-border bg-background/40 font-mono text-[10px] uppercase tracking-[0.2em]">
                Design system · Motion engine · Shader engine
              </Badge>
            </FadeIn>
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
              <AuroraText speed={1}>Codebase intelligence</AuroraText>
            </h1>
            <div className="mt-5 font-mono text-foreground/90">
              <DiaTextReveal text={["Understand", "Analyze", "Build"]} repeat speed={1} hold={1.6} />
            </div>
            <SlideIn direction="up" delay={0.15} className="mt-8 max-w-xl">
              <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                A serious engineering platform — cinematic, technical, minimal.
                Repository content always stays visually dominant; motion only
                earns its place.
              </p>
            </SlideIn>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild>
                <a href="#motion">Explore the system</a>
              </Button>
              <Button variant="outline" asChild>
                <a href="#shader">Shader lab</a>
              </Button>
            </div>
          </div>
        </section>

        {/* ── Labs ──────────────────────────────────────────────────── */}
        <MotionLab />
        <ShaderLab />
      </main>

      {/* ── Footer (sticky bottom via mt-auto) ───────────────────────── */}
      <footer className="mt-auto border-t border-subtle pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <span>
            CodeMind X V2 · Phase 1 — design tokens, motion primitives, shader
            engine
          </span>
          <span className="font-mono">
            checkpoint: codemind-v2/phase-01-ui
          </span>
        </div>
      </footer>
    </div>
  );
}
