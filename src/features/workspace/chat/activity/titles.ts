"use client";

/**
 * CodeMind X V2 — controlled activity titles + kind mapping (Phase 8D).
 *
 * CRITICAL (master prompt "FIXED ACTIVITY TITLES" + "NO MODEL FREE-TEXT"):
 * row titles ALWAYS come from these deterministic templates, keyed by the
 * adapter's view kind. Arbitrary model-generated strings are never rendered
 * as titles, and there is deliberately NO "reasoning" kind.
 *
 * The Solving trigger set (spec A.2, extended by explicit user direction in
 * the Phase-9 polish pass): real mutating/executing activity — INCLUDING
 * repository file reads — transitions the phase machine from thinking →
 * solving. Whenever the run reads or edits anything, the user must SEE the
 * orb + "Solving"; pure conversation (understanding + composing alone)
 * stays Thinking. Solving never reverts.
 */

import type { ActivityViewKind } from "@/types/contracts";

/** Fixed title templates (spec "FIXED ACTIVITY TITLES"). */
const TITLE_TEMPLATES: Record<ActivityViewKind, string> = {
  understand: "Understanding the request",
  analysis: "Analyzing request",
  plan: "Planning changes",
  web_search: "Searching the web",
  repo_search: "Searching repository",
  read_file: "Reading",
  create_file: "Creating",
  edit_file: "Editing",
  delete_file: "Removing",
  rename_file: "Renaming",
  run_command: "Running",
  run_tests: "Running tests",
  verify: "Verifying changes",
  prepare: "Preparing response",
  tool: "Working",
  waiting_approval: "Waiting for approval",
  waiting_question: "Waiting for your answer",
  error: "Task failed",
};

export function titleForKind(kind: ActivityViewKind): string {
  return TITLE_TEMPLATES[kind];
}

/**
 * Kinds whose first REAL activity transitions the run into Solving
 * (spec A.2 + Phase-9 user direction: reading real files is visibly doing
 * work — the orb appears the moment files are read or edited).
 */
const SOLVING_TRIGGERS: ReadonlySet<ActivityViewKind> = new Set([
  "read_file",
  "create_file",
  "edit_file",
  "delete_file",
  "rename_file",
  "run_command",
  "run_tests",
]);

export function triggersSolving(kind: ActivityViewKind): boolean {
  return SOLVING_TRIGGERS.has(kind);
}

/**
 * Kinds that merge into one grouped row when 4+ consecutive operations of
 * the same kind arrive (spec "LONG-RUN / LOOP POLICY"): "Read 12 files",
 * "Running 8 checks", "Edited 5 files".
 */
const GROUPABLE: ReadonlySet<ActivityViewKind> = new Set([
  "read_file",
  "repo_search",
  "create_file",
  "edit_file",
  "delete_file",
  "run_command",
  "run_tests",
  "web_search",
  "tool",
]);

export function isGroupable(kind: ActivityViewKind): boolean {
  return GROUPABLE.has(kind);
}

/** Group-row title for N merged same-kind operations. */
export function groupTitleFor(kind: ActivityViewKind, count: number): string {
  switch (kind) {
    case "read_file":
      return `Read ${count} file${count === 1 ? "" : "s"}`;
    case "repo_search":
      return `Searched repository ${count}×`;
    case "create_file":
      return `Created ${count} file${count === 1 ? "" : "s"}`;
    case "edit_file":
      return `Edited ${count} file${count === 1 ? "" : "s"}`;
    case "delete_file":
      return `Removed ${count} file${count === 1 ? "" : "s"}`;
    case "run_command":
      return `Ran ${count} command${count === 1 ? "" : "s"}`;
    case "run_tests":
      return `Ran ${count} check${count === 1 ? "" : "s"}`;
    case "web_search":
      return `Searched the web ${count}×`;
    default:
      return `Running ${count} checks`;
  }
}

/**
 * Map a backend ActivityNode (kind, fixed stage title) onto the view kind.
 * The backend's stage titles come from its own fixed server-side vocabulary
 * (SAFE_ACTIVITY_SUMMARIES), so the pair (kind, title) maps deterministically.
 * Unknown combinations fall back to the coarse category kind — the mapping
 * never invents an activity that did not happen.
 */
export function mapViewKind(
  backendKind: string,
  backendTitle: string,
): ActivityViewKind {
  const title = backendTitle.toLowerCase();

  // Stage titles first (fixed server vocabulary — authoritative).
  if (title.startsWith("understanding")) return "understand";
  if (title.startsWith("searching repository")) return "repo_search";
  if (title.startsWith("reading")) return "read_file";
  if (title.startsWith("composing")) return "prepare";
  if (title.startsWith("preparing")) return "prepare";
  if (title.startsWith("planning")) return "plan";
  if (title.startsWith("checking dependencies")) return "analysis";
  if (title.startsWith("writing patch")) return "edit_file";
  if (title.startsWith("running tests")) return "run_tests";
  if (title.startsWith("checking security")) return "verify";
  if (title.startsWith("preparing preview")) return "verify";

  // Coarse backend categories → view kinds.
  switch (backendKind) {
    case "steps":
      return "understand";
    case "search":
      return "repo_search";
    case "coding":
      return "edit_file";
    case "testing":
      return "run_tests";
    case "security":
      return "verify";
    case "git":
      return "tool";
    case "architecture":
      return "analysis";
    case "deployment":
      return "run_command";
    case "read_file":
      return "read_file";
    case "run_tests":
      return "run_tests";
    case "create_patch":
      return "edit_file";
    default:
      return "tool";
  }
}

/**
 * Middle-ellipsis for long display paths: keeps both ends readable
 * ("src/features/…/editor-navigation.ts") with the complete path in title.
 */
export function middleEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.max(6, Math.floor((max - 1) * 0.45));
  const tail = Math.max(8, max - 1 - head);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
