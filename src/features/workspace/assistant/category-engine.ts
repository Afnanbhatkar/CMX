/**
 * CodeMind X V2 — Category Engine (Phase 8B §6).
 *
 * Selects the activity categories a run actually used and maps engine
 * ActivityNodes onto the ThoughtChain's Odyssey steps. The engine NEVER
 * shows every category — only what really ran, with children that are safe
 * tool summaries (execution facts, never model reasoning).
 *
 * Pure functions, no React — unit-verifiable via window.__cmxAssistant.
 */

import type { LucideIcon } from "lucide-react";
import {
  Brain,
  CheckCheck,
  Code2,
  FlaskConical,
  GitBranch,
  Network,
  Rocket,
  Search,
  ShieldCheck,
} from "lucide-react";

import type {
  ActivityCategory,
  ActivityNode,
  SafeToolSummary,
} from "./contracts";
import { ACTIVITY_CATEGORY_LABELS } from "./contracts";
import type { ActivityKind } from "@/types/contracts";

/** Category display metadata (icon + label), closed vocabulary. */
export const CATEGORY_META: Record<
  ActivityCategory,
  { label: string; icon: LucideIcon; activityKind: ActivityKind }
> = {
  steps: { label: ACTIVITY_CATEGORY_LABELS.steps, icon: Brain, activityKind: "understanding" },
  search: { label: ACTIVITY_CATEGORY_LABELS.search, icon: Search, activityKind: "search" },
  coding: { label: ACTIVITY_CATEGORY_LABELS.coding, icon: Code2, activityKind: "code" },
  testing: { label: ACTIVITY_CATEGORY_LABELS.testing, icon: FlaskConical, activityKind: "test" },
  security: { label: ACTIVITY_CATEGORY_LABELS.security, icon: ShieldCheck, activityKind: "security" },
  git: { label: ACTIVITY_CATEGORY_LABELS.git, icon: GitBranch, activityKind: "git" },
  architecture: { label: ACTIVITY_CATEGORY_LABELS.architecture, icon: Network, activityKind: "architecture" },
  deployment: { label: ACTIVITY_CATEGORY_LABELS.deployment, icon: Rocket, activityKind: "deployment" },
};

/** ActivityCategory (contracts) → ActivityKind (types) for the chain rows. */
const NODE_KIND_TO_ACTIVITY_KIND: Record<ActivityCategory | SafeToolSummary["tool"], ActivityKind> = {
  steps: "understanding",
  search: "search",
  coding: "code",
  testing: "test",
  security: "security",
  git: "git",
  architecture: "architecture",
  deployment: "deployment",
  read_file: "read",
  run_tests: "test",
  create_patch: "code",
};

/**
 * The categories that ACTUALLY ran, in stable display order. A run that only
 * understood + answered shows ["steps"]; a search-backed run shows
 * ["steps", "search"]; nothing is ever fabricated into this list.
 */
export function selectRelevantCategories(activities: ActivityNode[]): ActivityCategory[] {
  const present = new Set<ActivityCategory>();
  for (const activity of activities) {
    if (isCategory(activity.kind)) present.add(activity.kind);
  }
  const order: ActivityCategory[] = [
    "steps",
    "search",
    "coding",
    "testing",
    "security",
    "git",
    "architecture",
    "deployment",
  ];
  return order.filter((c) => present.has(c));
}

function isCategory(kind: string): kind is ActivityCategory {
  return kind in CATEGORY_META;
}

/** ActivityNode.status → ThoughtStepStatus (failed → "error"). */
export function toStepStatus(
  status: ActivityNode["status"],
): "pending" | "active" | "done" | "error" {
  switch (status) {
    case "queued":
      return "pending";
    case "active":
      return "active";
    case "completed":
      return "done";
    case "failed":
    case "cancelled":
      return "error";
    default:
      return "pending";
  }
}

/** One safe tool summary → one chain child row label. */
function childLabel(summary: SafeToolSummary): string {
  switch (summary.tool) {
    case "read_file":
      return `read_file ${summary.path}`;
    case "search":
      return `"${summary.query}" — ${summary.hits} result${summary.hits === 1 ? "" : "s"}`;
    case "run_tests":
      return `run_tests ${summary.target}${summary.passed === null ? "" : summary.passed ? " ✓" : " ✕"}`;
    case "create_patch":
      return `create_patch ${summary.path}${summary.approved ? " ✓" : " ○"}`;
    default:
      return "tool step";
  }
}

/** Map one engine ActivityNode onto an Odyssey chain step. */
export function activityToStep(
  activity: ActivityNode,
): {
  id: string;
  kind: ActivityKind;
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail: string | null;
  children: { id: string; label: string; status: "pending" | "active" | "done" | "error" }[];
} {
  return {
    id: activity.id,
    kind: isCategory(activity.kind)
      ? NODE_KIND_TO_ACTIVITY_KIND[activity.kind]
      : NODE_KIND_TO_ACTIVITY_KIND[activity.kind as SafeToolSummary["tool"]] ?? "understanding",
    label: activity.title,
    status: toStepStatus(activity.status),
    detail: activity.summary,
    children: activity.children.map((child, index) => ({
      id: `${activity.id}-child-${index}`,
      label: childLabel(child),
      status:
        child.tool === "run_tests"
          ? child.passed === null
            ? "active"
            : child.passed
              ? "done"
              : "error"
          : child.tool === "create_patch"
            ? child.approved
              ? "done"
              : "pending"
            : "done",
    })),
  };
}

/** The full chain for a run: engine activities → ThoughtChain steps. */
export function activitiesToSteps(
  activities: ActivityNode[],
): ReturnType<typeof activityToStep>[] {
  return activities.map(activityToStep);
}

/** Finalize-step label used at run completion ("Thought for 8.4s"). */
export function thoughtForLabel(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null;
  return `Thought for ${(durationMs / 1000).toFixed(1)}s`;
}

/* ------------------------------------------------------------------ */
/* Run-snapshot → chain (Phase 8B live view)                           */
/* ------------------------------------------------------------------ */

/** Structural source (satisfied by the ActivityEngineSnapshot). */
export interface RunStepSource {
  activities: ActivityNode[];
  searchResults: { query: string; hits: number; topFiles: string[] }[];
  fileReferences: { path: string; line: number | null }[];
}

/**
 * Build the ThoughtChain steps for a live/historical run: engine activities
 * mapped onto Odyssey steps, with the run's real SEARCH_RESULT and
 * FILE_REFERENCED facts merged as children of the matching category rows
 * (search hits under "Searching repository", non-search file reads under
 * "Reading files"). Only facts the engine actually recorded appear here.
 */
export function buildRunSteps(
  source: RunStepSource,
): ReturnType<typeof activityToStep>[] {
  const steps = source.activities.map(activityToStep);

  const searchTopFiles = new Set(
    source.searchResults.flatMap((r) => r.topFiles),
  );
  const readFileRefs = source.fileReferences.filter(
    (f) => !searchTopFiles.has(f.path),
  );
  const searchFileRefs = source.fileReferences.filter((f) =>
    searchTopFiles.has(f.path),
  );

  return steps.map((step) => {
    const children = [...(step.children ?? [])];

    if (step.kind === "search" && source.searchResults.length > 0) {
      for (const result of source.searchResults) {
        children.push({
          id: `${step.id}-q-${children.length}`,
          label: `"${result.query}" — ${result.hits} result${result.hits === 1 ? "" : "s"}`,
          status: "done",
        });
      }
      for (const ref of searchFileRefs) {
        children.push({
          id: `${step.id}-f-${children.length}`,
          label: `top hit ${ref.path}${ref.line !== null ? `:${ref.line}` : ""}`,
          status: "done",
        });
      }
    }

    if (step.id === "reading-files" && readFileRefs.length > 0) {
      for (const ref of readFileRefs) {
        children.push({
          id: `${step.id}-f-${children.length}`,
          label: `read_file ${ref.path}${ref.line !== null ? `:${ref.line}` : ""}`,
          status: "done",
        });
      }
    }

    return children.length > 0 ? { ...step, children } : step;
  });
}
