/**
 * CodeMind X V2 — code parse worker (V2.1 ADDITIONS §B).
 *
 * Module web worker that moves code parsing OFF the main UI thread:
 * - PRIMARY engine: real tree-sitter (web-tree-sitter WASM) for supported
 *   languages — AST symbols with true start/end lines;
 * - FALLBACK engine: the shared deterministic structural scan (regex over
 *   real content) whenever tree-sitter cannot load for a language.
 *
 * The engine ACTUALLY used is reported in every response — the UI labels
 * results honestly (never "Tree-sitter" when the fallback ran).
 *
 * Imports/constructs always come from the structural scanner (they are a
 * CodeMind index vocabulary, not AST features) — reported separately.
 */

import { scanStructure, type ScanConstruct, type ScanImport, type ScanSymbol } from "@/lib/code-intel/structure-scanner";

export type ParseEngine = "tree-sitter" | "structural-scan" | "unavailable";

export interface ParseRequest {
  id: string;
  type: "scan";
  path: string;
  content: string;
  languageId: string;
}

export interface ParseResponse {
  id: string;
  ok: boolean;
  /** Engine that produced the SYMBOLS (the primary parse). */
  engine: ParseEngine;
  /** Engine for imports/constructs (always the structural scanner). */
  auxEngine: "structural-scan" | "unavailable";
  symbols: ScanSymbol[];
  imports: ScanImport[];
  constructs: ScanConstruct[];
  parseMs: number;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* tree-sitter (lazy, cached, fault-tolerant)                          */
/* ------------------------------------------------------------------ */

const GRAMMAR_BY_LANGUAGE: Record<string, string> = {
  typescript: "/wasm/tree-sitter-typescript.wasm",
  javascript: "/wasm/tree-sitter-javascript.wasm",
  python: "/wasm/tree-sitter-python.wasm",
  json: "/wasm/tree-sitter-json.wasm",
  css: "/wasm/tree-sitter-css.wasm",
  shell: "/wasm/tree-sitter-bash.wasm",
  bash: "/wasm/tree-sitter-bash.wasm",
  html: "/wasm/tree-sitter-html.wasm",
  xml: "/wasm/tree-sitter-html.wasm",
};

/** tsx uses the tsx grammar; ts files use the typescript grammar. */
function grammarFor(languageId: string, path: string): string | null {
  if (/\.tsx$/i.test(path)) return "/wasm/tree-sitter-tsx.wasm";
  if (/\.jsx$/i.test(path)) return "/wasm/tree-sitter-javascript.wasm";
  return GRAMMAR_BY_LANGUAGE[languageId] ?? null;
}

type TsParser = { setLanguage(lang: unknown): void; parse(text: string): unknown };
type TsLanguage = unknown;

let parserInitPromise: Promise<boolean> | null = null;
let parserInstance: TsParser | null = null;
const loadedLanguages = new Map<string, TsLanguage | null>(); // grammar → language (null = failed)

/**
 * The web-tree-sitter runtime is SELF-HOSTED at /wasm/tree-sitter.js and
 * imported natively inside the worker (turbopackIgnore keeps the bundler
 * away from the library's node-environment detection, which references the
 * node "module" builtin). In a browser worker that code path never runs.
 */
async function importWebTreeSitter(): Promise<{
  Parser: { init(opts: { locateFile: (f: string) => string }): Promise<void> };
  Language: { load(url: string): Promise<TsLanguage> };
} | null> {
  try {
    const mod = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ "/wasm/tree-sitter.js"
    )) as unknown as {
      Parser: { init(opts: { locateFile: (f: string) => string }): Promise<void> };
      Language: { load(url: string): Promise<TsLanguage> };
    };
    return mod;
  } catch {
    return null;
  }
}

async function ensureParser(): Promise<boolean> {
  if (parserInstance) return true;
  if (!parserInitPromise) {
    parserInitPromise = (async () => {
      try {
        const mod = await importWebTreeSitter();
        if (!mod) return false;
        await mod.Parser.init({ locateFile: (file: string) => `/wasm/${file}` });
        parserInstance = new (mod.Parser as unknown as { new (): TsParser })();
        return true;
      } catch {
        return false;
      }
    })();
  }
  return parserInitPromise;
}

async function languageFor(grammarUrl: string): Promise<TsLanguage | null> {
  if (loadedLanguages.has(grammarUrl)) return loadedLanguages.get(grammarUrl) ?? null;
  try {
    const mod = await importWebTreeSitter();
    if (!mod) {
      loadedLanguages.set(grammarUrl, null);
      return null;
    }
    const language = await mod.Language.load(grammarUrl);
    loadedLanguages.set(grammarUrl, language);
    return language;
  } catch {
    loadedLanguages.set(grammarUrl, null);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* AST symbol extraction (manual walk — no query-API version coupling) */
/* ------------------------------------------------------------------ */

interface TsNode {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  child(i: number): TsNode | null;
  children: TsNode[];
  text: string;
  namedChildren?: TsNode[];
}

function childOfType(node: TsNode, type: string): TsNode | null {
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child && child.type === type) return child;
  }
  return null;
}

function childText(node: TsNode, type: string): string | null {
  const child = childOfType(node, type);
  return child ? child.text : null;
}

/**
 * Extract symbols from an AST node. Kind is derived from the REAL node type
 * (never guessed): declarations map 1:1 to CodeMind symbol kinds.
 */
function collectAstSymbols(node: TsNode, out: ScanSymbol[], depth: number): void {
  if (out.length >= 1000 || depth > 400) return;

  switch (node.type) {
    case "function_declaration":
    case "function_signature":
    case "generator_function_declaration": {
      const name = childText(node, "identifier");
      if (name) {
        out.push({
          name,
          kind: "function",
          line: node.startPosition.row + 1,
          column: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      break;
    }
    case "class_declaration":
    case "class": {
      const name = childText(node, "identifier") ?? childText(node, "name");
      if (name) {
        out.push({
          name,
          kind: "class",
          line: node.startPosition.row + 1,
          column: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      break;
    }
    case "method_definition": {
      const name = childText(node, "property_identifier");
      if (name) {
        out.push({
          name,
          kind: "method",
          line: node.startPosition.row + 1,
          column: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      break;
    }
    case "interface_declaration": {
      const name = childText(node, "type_identifier");
      if (name) {
        out.push({
          name,
          kind: "interface",
          line: node.startPosition.row + 1,
          column: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      break;
    }
    case "type_alias_declaration": {
      const name = childText(node, "type_identifier");
      if (name) {
        out.push({
          name,
          kind: "type",
          line: node.startPosition.row + 1,
          column: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      break;
    }
    case "enum_declaration": {
      const name = childText(node, "identifier");
      if (name) {
        out.push({
          name,
          kind: "enum",
          line: node.startPosition.row + 1,
          column: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      break;
    }
    case "lexical_declaration":
    case "variable_declaration": {
      for (let i = 0; i < node.childCount; i += 1) {
        const declarator = node.child(i);
        if (!declarator || declarator.type !== "variable_declarator") continue;
        const name = childText(declarator, "identifier");
        const hasFunction = !!childOfType(declarator, "arrow_function") ||
          !!childOfType(declarator, "function_expression") ||
          !!childOfType(declarator, "function");
        if (name && hasFunction) {
          out.push({
            name,
            kind: /^[A-Z]/.test(name) ? "component" : "function",
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            endLine: declarator.endPosition.row + 1,
          });
        }
      }
      break;
    }
    case "function_definition": {
      // python
      const name = childText(node, "identifier");
      if (name) {
        out.push({
          name,
          kind: "function",
          line: node.startPosition.row + 1,
          column: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      break;
    }
    default:
      break;
  }

  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child) collectAstSymbols(child, out, depth + 1);
  }
}

/* ------------------------------------------------------------------ */
/* Message handling                                                    */
/* ------------------------------------------------------------------ */

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const request = event.data;
  if (!request || request.type !== "scan" || typeof request.content !== "string") {
    return;
  }
  const started = performance.now();

  const finish = (
    engine: ParseEngine,
    symbols: ScanSymbol[],
    error?: string,
  ) => {
    const aux = scanStructure(request.content, request.languageId);
    const response: ParseResponse = {
      id: request.id,
      ok: !error,
      engine,
      auxEngine: "structural-scan",
      symbols,
      imports: aux.imports,
      constructs: aux.constructs,
      parseMs: Math.round((performance.now() - started) * 100) / 100,
      error,
    };
    (self as unknown as Worker).postMessage(response);
  };

  const grammarUrl = grammarFor(request.languageId, request.path);

  void (async () => {
    if (!grammarUrl) {
      // No grammar for this language — structural scan, honestly labeled.
      const aux = scanStructure(request.content, request.languageId);
      finish("structural-scan", aux.symbols);
      return;
    }
    const parserReady = await ensureParser();
    if (!parserReady || !parserInstance) {
      const aux = scanStructure(request.content, request.languageId);
      finish("structural-scan", aux.symbols, "tree-sitter runtime unavailable");
      return;
    }
    const language = await languageFor(grammarUrl);
    if (!language) {
      const aux = scanStructure(request.content, request.languageId);
      finish("structural-scan", aux.symbols, "grammar failed to load");
      return;
    }
    try {
      parserInstance.setLanguage(language);
      const tree = parserInstance.parse(request.content) as { rootNode: TsNode };
      const symbols: ScanSymbol[] = [];
      collectAstSymbols(tree.rootNode, symbols, 0);
      finish("tree-sitter", symbols);
    } catch (err) {
      const aux = scanStructure(request.content, request.languageId);
      finish(
        "structural-scan",
        aux.symbols,
        err instanceof Error ? err.message : "tree-sitter parse failed",
      );
    }
  })();
};
