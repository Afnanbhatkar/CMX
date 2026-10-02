"use client";

/**
 * How It Works — the 9-step engineering workflow (spec §25). At Phase 1
 * these are product concepts; the copy says so honestly.
 */
import {
  Bot,
  FileCheck,
  GitCompareArrows,
  ListChecks,
  Plug,
  ScanSearch,
  ShieldCheck,
  FlaskConical,
  Database,
} from "lucide-react";
import { SectionShell } from "../section-shell";
import { StaggerReveal, StaggerItem } from "@/components/motion/StaggerReveal";

const STEPS = [
  { icon: Plug, title: "Connect repository", text: "Point CodeMind X at a repository to begin." },
  { icon: Database, title: "Index and understand", text: "Files, symbols and dependencies become a connected model." },
  { icon: ScanSearch, title: "Search and analyze", text: "Hybrid search answers with citations, not guesses." },
  { icon: Bot, title: "Ask AI", text: "Grounded answers with an inspectable activity trail." },
  { icon: ListChecks, title: "Plan changes", text: "Complex work becomes a reviewable plan." },
  { icon: FileCheck, title: "Review", text: "Every proposal arrives as a visible diff." },
  { icon: FlaskConical, title: "Test", text: "Affected suites run before anything merges." },
  { icon: ShieldCheck, title: "Verify", text: "Security checks gate the change alongside tests." },
  { icon: GitCompareArrows, title: "Apply", text: "You approve; the ChangeSet lands. Nothing applies silently." },
] as const;

export function HowItWorksSection() {
  return (
    <SectionShell
      id="how-it-works"
      eyebrow="How It Works"
      title="From repository to verified change"
      description="The workflow CodeMind X is built around — the same loop whether you are asking a question, planning a refactor or shipping a fix."
      note="Workflow preview — each step becomes live as later phases of the platform land."
    >
      <StaggerReveal className="relative grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" stagger={0.06}>
        {STEPS.map((step, i) => (
          <StaggerItem key={step.title}>
            <div className="group relative h-full rounded-md border border-border bg-surface p-4 transition-colors hover:border-primary/40 hover:bg-surface-hover">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-sm border border-border-subtle bg-surface-elevated">
                  <step.icon className="size-4 text-primary" aria-hidden="true" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                  step {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-3 text-sm font-medium text-foreground">{step.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.text}</p>
            </div>
          </StaggerItem>
        ))}
      </StaggerReveal>
    </SectionShell>
  );
}
