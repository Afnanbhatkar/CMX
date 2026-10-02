"use client";

/**
 * Hero — the primary public experience.
 *
 * Communicates WHAT CodeMind X is within the first screen: product language,
 * one animated AuroraText phrase, capability signals, and a real product
 * preview. Shader + particle layers are decorative, bounded, and degrade
 * gracefully; heavy pieces load client-side so text/content paint first.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowRight, Asterisk } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuroraText } from "@/components/motion/AuroraText";
import { motionDuration, motionEase } from "@/lib/design-tokens";

const ShaderBackground = dynamic(
  () => import("@/components/background/ShaderBackground").then((m) => m.ShaderBackground),
  { ssr: false },
);
const InteractiveParticles = dynamic(
  () => import("@/components/particles/InteractiveParticles").then((m) => m.InteractiveParticles),
  { ssr: false },
);
const ProductPreview = dynamic(
  () => import("@/components/product/ProductPreview").then((m) => m.ProductPreview),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden="true"
        className="h-[420px] w-full animate-pulse rounded-lg border border-border bg-surface sm:h-[440px] md:h-[480px] motion-reduce:animate-none"
      />
    ),
  },
);

const CAPABILITIES = [
  "Repository Intelligence",
  "Hybrid Search",
  "Code Understanding",
  "AI Coding",
  "Architecture",
  "Security",
  "Testing",
  "Git",
] as const;

const enter = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: motionDuration.slow, ease: motionEase.outSoft },
});

export function Hero() {
  const prefersReduced = useReducedMotion();

  return (
    <section id="top" className="relative overflow-hidden pb-16 pt-28 sm:pt-32">
      {/* ── Decorative background layers (bounded, degrading) ── */}
      <div className="absolute inset-0" aria-hidden="true">
        <ShaderBackground
          mode="rust-mesh"
          speed={0.5}
          intensity={0.85}
          opacity={0.55}
          grain
          mouseInteraction
          mobileMode="auto"
          reducedMotion="auto"
        />
        <InteractiveParticles className="absolute inset-x-0 top-0 h-[560px]" density={64} />
        {/* readability veil + bottom fade into page background */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_60%_at_50%_32%,transparent_35%,var(--background)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* Eyebrow */}
        <motion.p
          {...(prefersReduced ? {} : enter(0))}
          className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface/70 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground"
        >
          <Asterisk className="size-3 text-primary" aria-hidden="true" />
          AI software engineering platform
        </motion.p>

        {/* Headline — one animated phrase, hierarchy through restraint */}
        <motion.h1
          {...(prefersReduced ? {} : enter(0.08))}
          className="mt-5 max-w-3xl text-balance text-4xl font-medium leading-[1.06] tracking-tight text-foreground sm:text-6xl md:text-[4.25rem]"
        >
          Understand your codebase.{" "}
          <AuroraText speed={0.85} className="font-medium">
            Build with context.
          </AuroraText>
        </motion.h1>

        <motion.p
          {...(prefersReduced ? {} : enter(0.16))}
          className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
        >
          CodeMind X brings repository intelligence, hybrid search, architecture awareness
          and verified AI coding into one engineering workspace. AI proposes — you review,
          the system verifies, then changes are applied.
        </motion.p>

        {/* CTAs — the live workspace shipped in Phase 2 lives at /app */}
        <motion.div
          {...(prefersReduced ? {} : enter(0.24))}
          className="mt-7 flex flex-wrap items-center gap-3"
        >
          <Button asChild size="lg" className="h-11 px-5 text-sm font-medium">
            <Link href="/app">
              Open Workspace
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="secondary"
            className="h-11 border-border-subtle bg-surface px-5 text-sm font-medium hover:bg-surface-hover"
          >
            <a href="#features">Explore Features</a>
          </Button>
          <a
            href="#how-it-works"
            className="group inline-flex items-center gap-1.5 px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            See How It Works
            <ArrowDown
              className="size-3.5 transition-transform group-hover:translate-y-0.5 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </a>
        </motion.div>

        {/* Capability signals — informational labels, not metrics */}
        <motion.ul
          {...(prefersReduced ? {} : enter(0.34))}
          aria-label="CodeMind X capabilities"
          className="mt-8 flex max-w-3xl flex-wrap gap-1.5"
        >
          {CAPABILITIES.map((c) => (
            <li
              key={c}
              className="rounded-sm border border-border-subtle bg-surface/60 px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground"
            >
              {c}
            </li>
          ))}
        </motion.ul>

        {/* Product preview */}
        <motion.div
          {...(prefersReduced ? {} : enter(0.4))}
          id="workspace"
          className="mt-12 scroll-mt-24 sm:mt-16"
        >
          <ProductPreview />
          <p className="mt-3 text-center text-[11.5px] text-muted-foreground/80">
            Workspace preview — the live CodeMind X workspace ships in Phase&nbsp;2. This page
            shows the real product layout and workflow.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
