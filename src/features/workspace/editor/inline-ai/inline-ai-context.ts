"use client";

/**
 * CodeMind X V2 — inline AI context + measurement (Phase 8.75).
 *
 * Builds the REAL editor context the completion prompt receives (current
 * file around the cursor, nearby text-scan symbols, open tabs, recent
 * edits, current selection, project rules — the rules excerpt is read
 * server-side from RULES.md) and keeps the honest latency/usage stats for
 * the completion feature (§6: measured, never claimed).
 */

import type { editor as MonacoEditorNS } from "monaco-editor";

import { useWorkspaceStore } from "@/stores/workspace-store";

import { extractSymbols } from "../code-intelligence";

/* ------------------------------------------------------------------ */
/* Recent edits ring (real content-change events, capped)              */
/* ------------------------------------------------------------------ */

export interface RecentEditEntry {
  path: string;
  at: number;
  /** Inserted characters from the actual model change event. */
  chars: number;
}

const RECENT_EDIT_CAP = 24;
const recentEdits: RecentEditEntry[] = [];

export function recordEditorEdit(path: string, chars: number): void {
  if (!path) return;
  recentEdits.push({ path, at: Date.now(), chars });
  if (recentEdits.length > RECENT_EDIT_CAP) recentEdits.shift();
}

/** Short human-readable descriptions for the completion prompt. */
export function describeRecentEdits(currentPath: string): string[] {
  const now = Date.now();
  const seen = new Set<string>();
  const descriptions: string[] = [];
  for (let i = recentEdits.length - 1; i >= 0 && descriptions.length < 6; i -= 1) {
    const entry = recentEdits[i]!;
    if (now - entry.at > 5 * 60_000) break;
    const key = `${entry.path}:${Math.round(entry.at / 2_000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ago = now - entry.at;
    const agoLabel = ago < 10_000 ? "just now" : `${Math.round(ago / 1000)}s ago`;
    const where = entry.path === currentPath ? "this file" : entry.path;
    descriptions.push(`${where} · ~${entry.chars} chars · ${agoLabel}`);
  }
  return descriptions;
}

/* ------------------------------------------------------------------ */
/* Active editor registry (provider + hover commands resolve through it)*/
/* ------------------------------------------------------------------ */

let activeEditor: MonacoEditorNS.IStandaloneCodeEditor | null = null;

export function registerActiveInlineAIEditor(
  editor: MonacoEditorNS.IStandaloneCodeEditor | null,
): void {
  activeEditor = editor;
}

export function getActiveInlineAIEditor(): MonacoEditorNS.IStandaloneCodeEditor | null {
  return activeEditor;
}

/* ------------------------------------------------------------------ */
/* Completion context (all REAL data, budgets enforced)                 */
/* ------------------------------------------------------------------ */

export interface InlineCompletionPayload {
  path: string;
  language: string;
  prefix: string;
  suffix: string;
  nearbySymbols: string[];
  openTabs: string[];
  recentEdits: string[];
  selection: string | null;
}

const PREFIX_BUDGET = 6_000;
const SUFFIX_BUDGET = 1_500;
const SYMBOL_WINDOW_LINES = 60;
const SYMBOL_CAP = 12;

export function collectCompletionContext(
  model: MonacoEditorNS.ITextModel,
  position: { lineNumber: number; column: number },
  language: string,
): InlineCompletionPayload {
  const value = model.getValue();
  const path = model.uri.path.replace(/^\//, "");
  const offset = model.getOffsetAt(position);
  const prefix = value.slice(Math.max(0, offset - PREFIX_BUDGET), offset);
  const suffix = value.slice(offset, offset + SUFFIX_BUDGET);

  const cursorLine = position.lineNumber;
  const nearbySymbols = extractSymbols(value, language)
    .filter((s) => Math.abs(s.line - cursorLine) <= SYMBOL_WINDOW_LINES)
    .slice(0, SYMBOL_CAP)
    .map((s) => `${s.kind} ${s.name} (line ${s.line})`);

  const store = useWorkspaceStore.getState();
  const openTabs = store.tabs
    .map((t) => t.path)
    .filter((p) => p && p !== path)
    .slice(0, 10);

  // Current selection (only from the ACTIVE editor to avoid cross-pane noise).
  let selection: string | null = null;
  const editor = getActiveInlineAIEditor();
  if (editor && editor.getModel() === model) {
    const sel = editor.getSelection();
    if (sel && !sel.isEmpty()) {
      selection = model.getValueInRange(sel).slice(0, 2_000);
    }
  }

  return {
    path,
    language,
    prefix,
    suffix,
    nearbySymbols,
    openTabs,
    recentEdits: describeRecentEdits(path),
    selection,
  };
}

/* ------------------------------------------------------------------ */
/* Honest measurement (§6 — p50/p95 of what users actually feel)        */
/* ------------------------------------------------------------------ */

export interface InlineAIStats {
  requests: number;
  shown: number;
  accepts: number;
  partialAccepts: number;
  cancellations: number;
  superseded: number;
  errors: number;
  cacheHits: number;
  /** User-perceived request→ghost-text latency (ms). */
  p50: number | null;
  p95: number | null;
  samples: number;
  lastError: string | null;
}

const SAMPLE_CAP = 60;
const latencySamples: number[] = [];

const counters = {
  requests: 0,
  shown: 0,
  accepts: 0,
  partialAccepts: 0,
  cancellations: 0,
  superseded: 0,
  errors: 0,
  cacheHits: 0,
};
let lastError: string | null = null;

export function countCompletion(event: keyof typeof counters): void {
  counters[event] += 1;
}
export function recordCompletionError(message: string): void {
  counters.errors += 1;
  lastError = message.slice(0, 200);
}
export function recordCompletionShown(totalMs: number): void {
  counters.shown += 1;
  latencySamples.push(totalMs);
  if (latencySamples.length > SAMPLE_CAP) latencySamples.shift();
}

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return Math.round(sorted[idx]!);
}

export function getInlineAIStats(): InlineAIStats {
  const sorted = [...latencySamples].sort((a, b) => a - b);
  return {
    ...counters,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    samples: sorted.length,
    lastError,
  };
}

/** Verification harness (read-only stats + cache control). */
export function ensureInlineAIHarness(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __cmxInlineAI?: unknown };
  if (w.__cmxInlineAI) return;
  w.__cmxInlineAI = {
    stats: getInlineAIStats,
    resetStats: () => {
      latencySamples.length = 0;
      for (const key of Object.keys(counters) as Array<keyof typeof counters>) {
        counters[key] = 0;
      }
      lastError = null;
    },
  };
}
