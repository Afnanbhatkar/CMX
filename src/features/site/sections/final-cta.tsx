"use client";

/**
 * Final CTA — a restrained close with one DiaTextReveal moment and a subtle
 * shader bed. Product-focused: the workspace arrives in Phase 2 and the CTA
 * says so honestly.
 */
import dynamic from "next/dynamic";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiaTextReveal } from "@/components/motion/DiaTextReveal";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

const ShaderBackground = dynamic(
  () => import("@/components/background/ShaderBackground").then((m) => m.ShaderBackground),
  { ssr: false },
);

export function FinalCta() {
  return (
    <section
      id="open"
      aria-label="Open CodeMind X"
      className="relative scroll-mt-20 overflow-hidden border-t border-border-subtle"
    >
      {/* Subtle shader bed — decorative, degrades to a static gradient */}
      <div className="absolute inset-0" aria-hidden="true">
        <ShaderBackground
          mode="minimal"
          speed={0.35}
          intensity={0.7}
          opacity={0.4}
          grain
          mouseInteraction={false}
          mobileMode="auto"
          reducedMotion="auto"
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_80%_at_50%_50%,transparent_20%,var(--background)_100%)]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center sm:px-6 sm:py-32">
        <ScrollReveal direction="up" className="max-w-3xl">
          <h2 className="text-balance text-3xl font-medium tracking-tight text-foreground sm:text-5xl">
            Your codebase is more than files.
          </h2>
          <p className="mt-4 min-h-[2.2em] text-lg text-muted-foreground sm:text-xl">
            <DiaTextReveal
              text={[
                "Understand how it connects.",
                "Build with context.",
                "Verify before you ship.",
              ]}
              speed={1.1}
              hold={1.8}
            />
          </p>
        </ScrollReveal>

        <ScrollReveal direction="up" delay={0.15} className="mt-8 flex flex-col items-center gap-3">
          <Button asChild size="lg" className="h-11 px-6 text-sm font-medium">
            <a href="#workspace">
              Open CodeMind X Workspace
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
          </Button>
          <p className="text-[11.5px] text-muted-foreground/80">
            The live engineering workspace ships in Phase&nbsp;2 — today this page is the
            honest product tour.
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}
