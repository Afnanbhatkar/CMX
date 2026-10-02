"use client";

/**
 * Engineering arc — Architecture, AI Coding, Security + Testing, and Git
 * Intelligence (spec §26-29, §56). Product visuals with honest demo labels.
 */
import { SectionShell } from "../section-shell";
import { GraphPreview } from "@/components/product/GraphPreview";
import { AICodingPreview } from "@/components/product/AICodingPreview";
import { SecurityPreview } from "@/components/product/SecurityPreview";
import { TestingPreview } from "@/components/product/TestingPreview";
import { GitPreview } from "@/components/product/GitPreview";

export function ArchitectureSection() {
  return (
    <SectionShell
      id="architecture"
      eyebrow="Architecture Intelligence"
      title="A living map of how your system fits together"
      description="Frontend, API, auth, storage, queues, search, AI and tests — rendered as a graph the platform can reason over, so impact analysis is structural rather than guesswork."
      note="Conceptual service graph — the Neo4j-backed engine is planned for a later phase."
    >
      <GraphPreview className="mx-auto max-w-4xl" />
    </SectionShell>
  );
}

export function AICodingSection() {
  return (
    <SectionShell
      id="ai-coding"
      eyebrow="AI Coding"
      title="AI proposes. You review. The system verifies."
      description="Coding changes flow through an explicit ChangeSet: context, plan, diff, verification, and your approval before anything is applied. No silent edits — ever."
      note="Workflow visualization — ChangeSets become executable in a later phase."
    >
      <AICodingPreview className="mx-auto max-w-4xl" />
    </SectionShell>
  );
}

export function SecurityTestingSection() {
  return (
    <SectionShell
      id="security"
      eyebrow="Security + Testing"
      title="Every change, checked from both sides"
      description="Security review and test intelligence run beside the code: findings with evidence and affected paths; suites with failures, coverage and regression risk."
      note="Synthetic demo data below — shown to demonstrate the review surfaces, not live results."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SecurityPreview />
        <TestingPreview />
      </div>
    </SectionShell>
  );
}

export function GitSection() {
  return (
    <SectionShell
      id="git"
      eyebrow="Git Intelligence"
      title="History that explains impact"
      description="From commit to changed files to affected symbols — Git intelligence connects history to the graph, so you know what a change touches before you ship it."
      note="Sample commit data for illustration."
    >
      <GitPreview className="mx-auto max-w-4xl" />
    </SectionShell>
  );
}
