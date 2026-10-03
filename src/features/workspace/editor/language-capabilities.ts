"use client";

/**
 * CodeMind X V2 — language capability model (V2.1 ADDITIONS §D).
 *
 * "Language capability honesty": every language-dependent feature carries a
 * badge naming the engine that REALLY backs it:
 *
 *   Definitions  → LSP (only when a language server is wired — none today)
 *   References   → LSP (same)
 *   Symbols      → Tree-sitter | structural scan (whatever really parsed)
 *   Diagnostics  → LSP | Tree-sitter | heuristic (Monaco syntax workers are
 *                  editor-native analysis — reported as such, not "LSP")
 *
 * Never show a feature as verified if only a placeholder exists: every
 * capability here is either backed by a live runtime (the parse worker's
 * last engine, Monaco markers) or explicitly `unavailable` with the honest
 * reason. CapabilityBadge renders these; nothing else may invent labels.
 */

import type { ParseEngine } from "./parse-worker/parse-worker-client";

/** The closed vocabulary of engines that can back a capability. */
export type CapabilitySource =
  | "lsp"
  | "tree-sitter"
  | "structural-scan"
  | "monaco-native"
  | "heuristic"
  | "unavailable";

export const CAPABILITY_SOURCE_META: Record<
  CapabilitySource,
  { label: string; tone: "ok" | "warn" | "off"; note: string }
> = {
  lsp: {
    label: "LSP",
    tone: "ok",
    note: "Backed by a language server protocol integration.",
  },
  "tree-sitter": {
    label: "Tree-sitter",
    tone: "ok",
    note: "Backed by a real tree-sitter (WASM) parse of this file.",
  },
  "structural-scan": {
    label: "Structural scan",
    tone: "warn",
    note: "Deterministic regex scan over the real file content — not a full parser.",
  },
  "monaco-native": {
    label: "Editor analysis",
    tone: "ok",
    note: "Monaco's built-in language workers (single-file syntax analysis).",
  },
  heuristic: {
    label: "Heuristic",
    tone: "warn",
    note: "Pattern-based heuristic over real content — verify before relying on it.",
  },
  unavailable: {
    label: "Not available",
    tone: "off",
    note: "No engine backs this feature yet — it is never simulated.",
  },
};

export interface LanguageCapabilitySet {
  definitions: CapabilitySource;
  references: CapabilitySource;
  symbols: CapabilitySource;
  diagnostics: CapabilitySource;
}

export interface LanguageCapabilities {
  /** The resolved per-feature sources for this language. */
  set: LanguageCapabilitySet;
  /** Explanations when a capability is NOT its end-state engine. */
  notes: Partial<Record<keyof LanguageCapabilitySet, string>>;
}

/** Languages the parse worker can genuinely parse with tree-sitter. */
const TREE_SITTER_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "python",
  "json",
  "css",
  "shell",
  "bash",
  "html",
  "xml",
]);

const LSP_NOTE =
  "A language server (LSP) arrives with the language intelligence phase — this capability is never simulated meanwhile.";

/**
 * Resolve the honest capability set for a language.
 *
 * @param languageId  Monaco language id of the active file.
 * @param symbolEngine The engine that ACTUALLY parsed the active file last
 *        (from parseWorkerClient.getEngine()); "unavailable" before a parse.
 */
export function getLanguageCapabilities(
  languageId: string,
  symbolEngine: ParseEngine,
): LanguageCapabilities {
  const astCapable = TREE_SITTER_LANGUAGES.has(languageId);

  let symbols: CapabilitySource;
  let symbolsNote: string | undefined;
  if (symbolEngine === "tree-sitter" && astCapable) {
    symbols = "tree-sitter";
  } else if (symbolEngine === "structural-scan") {
    symbols = "structural-scan";
    symbolsNote = astCapable
      ? "tree-sitter is available for this language but the fallback scan produced the current outline (first parse may still be initializing)."
      : "No tree-sitter grammar for this language — a deterministic structural scan is used.";
  } else {
    symbols = "unavailable";
    symbolsNote = astCapable
      ? "Open the file to parse its structure."
      : "No parser for this language — the outline stays empty rather than guessing.";
  }

  // Diagnostics: Monaco's TS/JS workers provide real single-file SYNTAX
  // analysis (editor-native). LSP/tree-sitter diagnostics remain future.
  let diagnostics: CapabilitySource;
  let diagnosticsNote: string | undefined;
  if (languageId === "typescript" || languageId === "javascript") {
    diagnostics = "monaco-native";
    diagnosticsNote =
      "Single-file syntax analysis from Monaco's language workers. Project-wide type checking (LSP) arrives in a later phase.";
  } else if (astCapable) {
    diagnostics = "unavailable";
    diagnosticsNote =
      "Syntax diagnostics for this language arrive with the language intelligence phase.";
  } else {
    diagnostics = "unavailable";
    diagnosticsNote = "No diagnostics engine for this language.";
  }

  return {
    set: {
      definitions: "unavailable",
      references: "unavailable",
      symbols,
      diagnostics,
    },
    notes: {
      definitions: LSP_NOTE,
      references: LSP_NOTE,
      symbols: symbolsNote,
      diagnostics: diagnosticsNote,
    },
  };
}

/** The capability feature names in stable display order. */
export const CAPABILITY_FEATURES: ReadonlyArray<keyof LanguageCapabilitySet> = [
  "definitions",
  "references",
  "symbols",
  "diagnostics",
];
