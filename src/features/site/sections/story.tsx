"use client";

/**
 * Story section — explains the actual problem CodeMind X exists to solve
 * (spec §12): repositories are not just collections of files; understanding
 * a codebase requires many kinds of context merged into one.
 */
import { motion, useReducedMotion } from "framer-motion";
import {
  Boxes,
  Braces,
  FileCode2,
  FlaskConical,
  GitBranch,
  Network,
  Search,
  ShieldCheck,
} from "lucide-react";
import { SectionShell } from "../section-shell";
import { TextRevealHeading } from "@/components/motion/TextReveal";
import { GradientText } from "@/components/motion/GradientText";
import { motionDuration, motionEase } from "@/lib/design-tokens";

const CONTEXT_TOKENS = [
  { icon: FileCode2, label: "files" },
  { icon: Braces, label: "symbols" },
  { icon: Network, label: "dependencies" },
  { icon: Boxes, label: "architecture" },
  { icon: GitBranch, label: "Git history" },
  { icon: FlaskConical, label: "tests" },
  { icon: ShieldCheck, label: "security" },
  { icon: Search, label: "runtime signals" },
] as const;

export function StorySection() {
  const prefersReduced = useReducedMotion();

  return (
    <SectionShell
      id="product"
      eyebrow="What is CodeMind X"
      title={
        <TextRevealHeading text="Software repositories are not just collections of files." />
      }
      description={
        <>
          Understanding a codebase means holding many kinds of context at once. CodeMind X
          brings them together into <GradientText animated>one engineering context</GradientText>{" "}
          — so answers, searches and proposed changes are grounded in how your software
          actually fits together.
        </>
      }
    >
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Left: the merge statement */}
        <div className="order-2 lg:order-1">
          <ol aria-label="Context CodeMind X brings together" className="flex flex-wrap gap-2">
            {CONTEXT_TOKENS.map(({ icon: Icon, label }, i) => (
              <motion.li
                key={label}
                initial={prefersReduced ? false : { opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{
                  delay: prefersReduced ? 0 : 0.05 * i,
                  duration: motionDuration.base,
                  ease: motionEase.outSoft,
                }}
                className="flex items-center gap-1.5 rounded-sm border border-border-subtle bg-surface px-2.5 py-1.5 text-xs text-muted-foreground"
              >
                <Icon className="size-3.5 text-primary/80" aria-hidden="true" />
                {label}
              </motion.li>
            ))}
          </ol>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
            A question about one function can touch all of these. Generic chat sees a snippet;
            CodeMind X sees the file, its callers, its tests, its history and its blast radius —
            and explains the connection, not just the text.
          </p>
        </div>

        {/* Right: tokens merging into one engineering context */}
        <div className="order-1 lg:order-2">
          <div className="relative mx-auto max-w-sm">
            <div className="flex flex-col items-stretch gap-1.5">
              {CONTEXT_TOKENS.slice(0, 4).map(({ icon: Icon, label }, i) => (
                <motion.div
                  key={label}
                  initial={prefersReduced ? false : { opacity: 0, x: 16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    delay: prefersReduced ? 0 : 0.1 * i,
                    duration: motionDuration.base,
                    ease: motionEase.outSoft,
                  }}
                  className="flex items-center justify-between rounded-sm border border-border-subtle bg-surface px-3 py-2"
                >
                  <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <Icon className="size-3.5 text-primary/70" aria-hidden="true" />
                    {label}
                  </span>
                  <span aria-hidden="true" className="h-px w-8 bg-border" />
                </motion.div>
              ))}
            </div>

            {/* Merge node */}
            <div className="relative my-2 ml-auto mr-6 h-6 w-px bg-border" aria-hidden="true" />
            <motion.div
              initial={prefersReduced ? false : { opacity: 0, scale: 0.96 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: motionDuration.slow, ease: motionEase.outSoft }}
              className="rounded-md border border-primary/35 bg-primary/10 px-4 py-3"
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">
                one engineering context
              </p>
              <p className="mt-1 text-[12.5px] leading-snug text-foreground/90">
                The same context powers search, answers, architecture views, security review
                and verified AI changes.
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
