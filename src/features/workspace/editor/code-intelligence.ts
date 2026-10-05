"use client";

/**
 * CodeMind X V2 — code intelligence contracts + honest text intelligence
 * (Phase 6 §3).
 *
 * HONESTY CONTRACT (spec §3 — "Do not fake language intelligence"):
 * - What exists: a REAL text-scan symbol outline (regex over the actual file
 *   content) and REAL syntax diagnostics from Monaco's TypeScript/JavaScript
 *   language worker. Both are labeled as text/single-file based in the UI.
 * - What does NOT exist (tree-sitter symbols, definitions, references,
 *   callers/callees, cross-file type checking, lint/security/AI diagnostics):
 *   the capability probes below return { available: false } with a reason and
 *   the UI renders [PLANNED] slots. Nothing invented, ever.
 */

import type { Monaco } from "@monaco-editor/react";
import type * as MonacoNS from "monaco-editor";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import { parseWorkerClient } from "./parse-worker/parse-worker-client";

/* ------------------------------------------------------------------ */
/* Text-scan symbol outline (REAL — computed from actual content)      */
/* ------------------------------------------------------------------ */

export type TextSymbolKind =
  | "class"
  | "function"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "constant"
  | "property";

export interface TextSymbol {
  name: string;
  kind: TextSymbolKind;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  detail?: string;
}

const TS_SYMBOL_PATTERNS: Array<{ re: RegExp; kind: TextSymbolKind }> = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { re: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: "function" },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: "type" },
  { re: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: "enum" },
  { re: /^\s{2}(?:public|private|protected|static|readonly|override\s)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::[^{]+)?\{/, kind: "method" },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, kind: "function" },
  { re: /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]+)\s*=/, kind: "constant" },
];

const PY_SYMBOL_PATTERNS: Array<{ re: RegExp; kind: TextSymbolKind }> = [
  { re: /^\s*class\s+([A-Za-z_][\w]*)/, kind: "class" },
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/, kind: "function" },
];

const JSON_SYMBOL_RE = /^"([^"]+)":/;

/**
 * REAL text-scan outline of ONE file's content. This is a regex scan over
 * the actual text — never a claimed language server.
 */
export function extractSymbols(content: string, languageId: string): TextSymbol[] {
  if (!content) return [];
  const symbols: TextSymbol[] = [];
  const lines = content.split("\n");
  const isTsLike = languageId === "typescript" || languageId === "javascript";
  const isPython = languageId === "python";
  const isJson = languageId === "json";
  if (!isTsLike && !isPython && !isJson) return symbols;

  for (let i = 0; i < lines.length && i < 20_000; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("#")) {
      continue;
    }
    if (isJson) {
      const match = JSON_SYMBOL_RE.exec(trimmed);
      if (match && line.startsWith('"')) {
        symbols.push({ name: match[1]!, kind: "property", line: i + 1, column: 1 });
      }
      continue;
    }
    const patterns = isPython ? PY_SYMBOL_PATTERNS : TS_SYMBOL_PATTERNS;
    for (const { re, kind } of patterns) {
      const match = re.exec(line);
      if (match?.[1]) {
        symbols.push({
          name: match[1],
          kind,
          line: i + 1,
          column: (match.index ?? 0) + 1,
          detail: trimmed.slice(0, 80),
        });
        break;
      }
    }
  }
  return symbols;
}

/* ------------------------------------------------------------------ */
/* Import scan (REAL — same regex basis as the Phase 5 panel)          */
/* ------------------------------------------------------------------ */

export interface ScannedImport {
  source: string;
  /** import x from "…" | require("…") | from … import … */
  kind: "import" | "require" | "from-import";
  line: number;
}

export function scanImports(content: string, languageId: string): ScannedImport[] {
  if (!content) return [];
  const isTsLike = languageId === "typescript" || languageId === "javascript";
  const isPython = languageId === "python";
  if (!isTsLike && !isPython) return [];

  const imports: ScannedImport[] = [];
  const lines = content.split("\n").slice(0, 20_000);
  const tsImport = /^\s*import\s[^'"]*['"]([^'"]+)['"]/;
  const tsExportFrom = /^\s*export\s[^'"]*from\s*['"]([^'"]+)['"]/;
  const jsRequire = /^\s*(?:const|let|var)\s[^=]+=\s*require\(\s*['"]([^'"]+)['"]/;
  const pyFrom = /^\s*from\s+([\w.]+)\s+import\b/;
  const pyImport = /^\s*import\s+([\w.]+)/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (isPython) {
      const from = pyFrom.exec(line);
      if (from?.[1]) {
        imports.push({ source: from[1], kind: "from-import", line: i + 1 });
        continue;
      }
      const imp = pyImport.exec(line);
      if (imp?.[1]) {
        imports.push({ source: imp[1], kind: "import", line: i + 1 });
      }
      continue;
    }
    const imp = tsImport.exec(line);
    if (imp?.[1]) {
      imports.push({ source: imp[1], kind: "import", line: i + 1 });
      continue;
    }
    const exp = tsExportFrom.exec(line);
    if (exp?.[1]) {
      imports.push({ source: exp[1], kind: "import", line: i + 1 });
      continue;
    }
    const req = jsRequire.exec(line);
    if (req?.[1]) {
      imports.push({ source: req[1], kind: "require", line: i + 1 });
    }
  }
  return imports;
}

/* ------------------------------------------------------------------ */
/* Capability probes (honest — used to render [PLANNED] slots)         */
/* ------------------------------------------------------------------ */

export type IntelligenceFeature =
  | "symbols-tree-sitter"
  | "diagnostics-lint"
  | "diagnostics-type"
  | "diagnostics-security"
  | "diagnostics-ai"
  | "definitions"
  | "references"
  | "callers"
  | "callees";

export interface IntelligenceCapability {
  available: boolean;
  reason: string;
}

/**
 * Honest capability matrix. `available:false` items are rendered as
 * [PLANNED] and NEVER produce invented data.
 */
export function getIntelligenceCapability(feature: IntelligenceFeature): IntelligenceCapability {
  switch (feature) {
    case "symbols-tree-sitter":
      return {
        available: false,
        reason: "Tree-sitter symbol extraction arrives with the language intelligence phase — a text-scan outline is shown meanwhile.",
      };
    case "diagnostics-lint":
      return { available: false, reason: "Live lint diagnostics arrive with the language intelligence phase." };
    case "diagnostics-type":
      return { available: false, reason: "Project-wide type checking needs cross-file resolution — planned for the language intelligence phase." };
    case "diagnostics-security":
      return { available: false, reason: "Security diagnostics arrive with the security intelligence phase." };
    case "diagnostics-ai":
      return { available: false, reason: "AI-flagged diagnostics arrive with the AI review phase." };
    case "definitions":
      return { available: false, reason: "Go-to-definition needs a language server (planned)." };
    case "references":
      return { available: false, reason: "Find references needs a language server (planned)." };
    case "callers":
      return { available: false, reason: "Callers/callees need a real call graph (planned)." };
    case "callees":
      return { available: false, reason: "Callers/callees need a real call graph (planned)." };
  }
}

/* ------------------------------------------------------------------ */
/* Monaco registration (editor runtime wiring)                         */
/* ------------------------------------------------------------------ */

let providersRegistered = false;

/**
 * Register the REAL outline document symbol provider (quick outline,
 * Ctrl+Shift+O) for the supported languages, plus the honest syntax-only
 * TS/JS diagnostics configuration. Idempotent.
 *
 * V2.1 §B: the outline provider is ASYNC and routes through the parse
 * worker — Monaco runs it on the main thread, but the actual parsing work
 * happens in the worker for files above the inline limit (tree-sitter
 * first, structural scan fallback; the engine label in the response is the
 * honest one).
 */
export function registerCodeIntelligenceProviders(monaco: Monaco): void {
  if (providersRegistered) return;
  providersRegistered = true;

  const outlineLanguages = ["typescript", "javascript", "python", "json"];

  for (const languageId of outlineLanguages) {
    monaco.languages.registerDocumentSymbolProvider(languageId, {
      async provideDocumentSymbols(model) {
        const value = model.getValue();
        const path = model.uri.path.replace(/^\//, "");
        const result = await parseWorkerClient.parse({
          path,
          content: value,
          languageId,
        });
        const symbols = result.ok ? result.symbols : [];
        const kindMap: Record<TextSymbolKind, MonacoNS.languages.SymbolKind> = {
          class: monaco.languages.SymbolKind.Class,
          function: monaco.languages.SymbolKind.Function,
          method: monaco.languages.SymbolKind.Method,
          interface: monaco.languages.SymbolKind.Interface,
          type: monaco.languages.SymbolKind.Interface,
          enum: monaco.languages.SymbolKind.Enum,
          variable: monaco.languages.SymbolKind.Variable,
          constant: monaco.languages.SymbolKind.Constant,
          property: monaco.languages.SymbolKind.Property,
          component: monaco.languages.SymbolKind.Function,
        };
        return symbols.map((symbol) => ({
          name: symbol.name,
          detail: symbol.detail ?? "",
          kind: kindMap[symbol.kind] ?? monaco.languages.SymbolKind.Variable,
          range: {
            startLineNumber: symbol.line,
            startColumn: symbol.column,
            endLineNumber: symbol.endLine ?? symbol.line,
            endColumn: (symbol.column ?? 1) + symbol.name.length,
          },
          selectionRange: {
            startLineNumber: symbol.line,
            startColumn: symbol.column,
            endLineNumber: symbol.line,
            endColumn: (symbol.column ?? 1) + symbol.name.length,
          },
          tags: [],
        }));
      },
    });
  }

  // REAL single-file syntax diagnostics from the TS/JS workers (Phase 6 §6).
  // Semantic/type validation stays OFF (no cross-file resolution → any
  // "errors" would be artifacts, i.e. fabricated-looking noise).
  try {
    const ts = monaco.languages.typescript;
    ts.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    ts.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    const compilerOptions = {
      target: ts.ScriptTarget.ESNext,
      jsx: ts.JsxEmit.React,
      allowNonTsExtensions: true,
      allowJs: true,
      esModuleInterop: true,
    };
    ts.typescriptDefaults.setCompilerOptions(compilerOptions);
    ts.javascriptDefaults.setCompilerOptions({ ...compilerOptions, checkJs: false });
  } catch {
    // Workers unavailable (offline edge) — the editor still works; the
    // diagnostics panel reports the real (empty) marker set.
  }
}

/**
 * Reserved integration anchor for the CodeLens provider (V2.1 §D / Phase 6).
 * Future phases register their provider here; nothing is simulated now.
 */
export function registerCodeLensProviderAnchor(
  monaco: Monaco,
  provider: MonacoNS.languages.CodeLensProvider,
): ReturnType<typeof MonacoNS.languages.registerCodeLensProvider> {
  return monaco.languages.registerCodeLensProvider(["typescript", "javascript", "python"], provider);
}

/**
 * Publish a file's text-scan outline to the navigation registry so
 * openSymbol(symbolId) works app-wide (V2.1 §A).
 */
export function publishOutlineToNavigation(filePath: string, symbols: TextSymbol[]): void {
  editorNavigation.registerTargets(
    `outline:${filePath}`,
    symbols.map((symbol) => ({
      id: `sym:${filePath}:${symbol.line}:${symbol.name}`,
      filePath,
      line: symbol.line,
      column: symbol.column,
      label: symbol.name,
    })),
  );
}
