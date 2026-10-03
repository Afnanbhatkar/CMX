/**
 * CodeMind X V2 — shared code structure scanner.
 *
 * ONE deterministic, regex-based scanner over REAL file content, used by:
 * - the client parse worker (V2.1 ADDITIONS §B — symbol outline, syntax
 *   structure and construct detection OFF the main thread);
 * - the Phase 7 server search indexer (code-aware index).
 *
 * HONESTY CONTRACT: this is a structural scan, NOT a language server and
 * NOT tree-sitter. Every consumer must label results with the engine that
 * produced them (see language-capabilities.ts / parse-worker-client.ts).
 * Nothing here invents symbols that are not literally present in the text.
 */

/* ------------------------------------------------------------------ */
/* Symbol outline (same basis as the Phase 6 text-scan outline)        */
/* ------------------------------------------------------------------ */

export type ScanSymbolKind =
  | "class"
  | "function"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "constant"
  | "property"
  | "component";

export interface ScanSymbol {
  name: string;
  kind: ScanSymbolKind;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  detail?: string;
  /** 1-based best-effort end line (brace balance for blocks). */
  endLine?: number;
}

const TS_SYMBOL_PATTERNS: Array<{ re: RegExp; kind: ScanSymbolKind }> = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { re: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: "function" },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: "type" },
  { re: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: "enum" },
  { re: /^\s{2}(?:public|private|protected|static|readonly|override\s)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::[^{]+)?\{/, kind: "method" },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, kind: "function" },
  { re: /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]+)\s*=/, kind: "constant" },
];

/** React-style component: capitalized identifier bound to a function/const. */
const COMPONENT_PATTERN =
  /^\s*(?:export\s+)?(?:const|function)\s+([A-Z][A-Za-z0-9_$]*)\b/;

const PY_SYMBOL_PATTERNS: Array<{ re: RegExp; kind: ScanSymbolKind }> = [
  { re: /^\s*class\s+([A-Za-z_][\w]*)/, kind: "class" },
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/, kind: "function" },
];

const JSON_SYMBOL_RE = /^"([^"]+)":/;

/** Best-effort brace-balance end line for a block starting at `startLine` (1-based). */
function findBlockEnd(lines: string[], startLine: number): number | undefined {
  let depth = 0;
  let opened = false;
  for (let i = startLine - 1; i < lines.length && i < startLine + 400; i += 1) {
    const line = lines[i]!;
    for (const ch of line) {
      if (ch === "{") {
        depth += 1;
        opened = true;
      } else if (ch === "}") {
        depth -= 1;
      }
    }
    if (opened && depth <= 0) return i + 1;
    if (!opened && line.trimEnd().endsWith(";")) return i + 1;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Imports                                                             */
/* ------------------------------------------------------------------ */

export interface ScanImport {
  source: string;
  kind: "import" | "require" | "from-import";
  line: number;
}

/* ------------------------------------------------------------------ */
/* Code-aware constructs (Phase 7 index vocabulary)                    */
/* ------------------------------------------------------------------ */

/**
 * Meaningful constructs the search index understands. Detection is
 * pattern-based over real content — never guessed.
 */
export type ConstructKind =
  | "route" // HTTP route handler (Next.js app-router route exports, etc.)
  | "api-call" // outbound HTTP request construction (fetch/axios)
  | "database" // database query/prisma-style access
  | "env-reference" // process.env.X / import.meta.env.X
  | "config" // configuration keys
  | "test" // test definitions
  | "component" // UI component definition
  | "hook" // react hook definition (useX)
  | "schema" // schema/type definitions (prisma model, zod object)
  | "documentation"; // documentation blocks/headings

export interface ScanConstruct {
  kind: ConstructKind;
  /** Human-readable identifier when one exists (route method, env var name…). */
  name: string | null;
  line: number;
  endLine?: number;
  detail?: string;
}

const ROUTE_PATTERN = /^\s*export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;
const API_CALL_PATTERN = /\b(?:fetch|axios|ofetch|\$fetch)\s*\(\s*[`'"]([^`'"]+)[`'"]/;
const DB_PATTERN = /\b(?:db|prisma|tx)\s*\.\s*[a-zA-Z_$][\w$]*\s*\.\s*(findUnique|findFirst|findMany|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy|queryRaw|executeRaw)\b/;
const ENV_PATTERN = /(?:process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]*)/;
const ZOD_SCHEMA_PATTERN = /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[a-z]\w*\.)?(?:object|string|number|boolean|enum|array|union|discriminatedUnion)\s*\(/;
const PRISMA_MODEL_PATTERN = /^\s*model\s+([A-Za-z_][\w]*)\s*\{/;
const HOOK_PATTERN = /^\s*(?:export\s+)?(?:function|const)\s+(use[A-Z][A-Za-z0-9_$]*)\b/;
const TEST_PATTERN = /^\s*(?:export\s+)?(?:it|test|describe)\s*\(\s*[`'"]([^`'"]+)[`'"]/;
const CONFIG_KEY_PATTERN = /^"([A-Za-z_$][\w$.-]{1,64})"\s*:/;
const DOC_BLOCK_PATTERN = /^\s*\/\*\*|^\s*#\s|^\s*\/\/\s/;

/* ------------------------------------------------------------------ */
/* The scan                                                            */
/* ------------------------------------------------------------------ */

export interface StructureScanResult {
  symbols: ScanSymbol[];
  imports: ScanImport[];
  constructs: ScanConstruct[];
  /** Engine that produced this scan — always "structural-scan" here. */
  engine: "structural-scan";
  /** Lines scanned (cap applied for pathological files). */
  scannedLines: number;
}

const MAX_SCAN_LINES = 30_000;

/**
 * Scan REAL content. Deterministic, synchronous, allocation-light. Callers
 * on the UI thread must route LARGE files through the parse worker
 * (parse-worker-client.ts decides) — this function itself is thread-agnostic.
 */
export function scanStructure(content: string, languageId: string): StructureScanResult {
  const symbols: ScanSymbol[] = [];
  const imports: ScanImport[] = [];
  const constructs: ScanConstruct[] = [];
  if (!content) return { symbols, imports, constructs, engine: "structural-scan", scannedLines: 0 };

  const lines = content.split("\n");
  const scanCount = Math.min(lines.length, MAX_SCAN_LINES);

  const isTsLike = languageId === "typescript" || languageId === "javascript";
  const isPython = languageId === "python";
  const isJson = languageId === "json";
  const isPrisma = languageId === "prisma";
  const isMarkdown = languageId === "markdown";
  const scanSymbols = isTsLike || isPython || isJson || isPrisma;

  for (let i = 0; i < scanCount; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) continue;

    /* ---- markdown documentation headings ---- */
    if (isMarkdown) {
      if (/^#{1,3}\s+/.test(trimmed)) {
        constructs.push({
          kind: "documentation",
          name: trimmed.replace(/^#+\s+/, "").slice(0, 80),
          line: i + 1,
        });
      }
      continue;
    }

    /* ---- documentation blocks ---- */
    if (!isJson && constructs.length < 400 && DOC_BLOCK_PATTERN.test(line)) {
      const prev = lines[i - 1] ?? "";
      if (!DOC_BLOCK_PATTERN.test(prev)) {
        constructs.push({ kind: "documentation", name: null, line: i + 1 });
      }
    }

    /* ---- JSON config keys ---- */
    if (isJson) {
      const match = JSON_SYMBOL_RE.exec(trimmed);
      if (match && line.startsWith('"')) {
        symbols.push({ name: match[1]!, kind: "property", line: i + 1, column: 1 });
      }
      const configKey = CONFIG_KEY_PATTERN.exec(trimmed);
      if (configKey && constructs.length < 400) {
        constructs.push({ kind: "config", name: configKey[1]!, line: i + 1 });
      }
      continue;
    }

    /* ---- Prisma schema ---- */
    if (isPrisma) {
      const model = PRISMA_MODEL_PATTERN.exec(trimmed);
      if (model) {
        const endLine = findBlockEnd(lines, i + 1);
        symbols.push({ name: model[1]!, kind: "class", line: i + 1, column: 1, endLine });
        constructs.push({ kind: "schema", name: model[1]!, line: i + 1, endLine });
      }
      continue;
    }

    /* ---- comments: only real env references inside comments count ---- */
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("#")) {
      const env = ENV_PATTERN.exec(line);
      if (env && constructs.length < 400) {
        constructs.push({ kind: "env-reference", name: env[1]!, line: i + 1 });
      }
      continue;
    }

    /* ---- imports ---- */
    if (isTsLike || isPython) {
      if (isPython) {
        const pyFrom = /^\s*from\s+([\w.]+)\s+import\b/.exec(line);
        if (pyFrom) {
          imports.push({ source: pyFrom[1]!, kind: "from-import", line: i + 1 });
        } else {
          const pyImport = /^\s*import\s+([\w.]+)/.exec(line);
          if (pyImport) imports.push({ source: pyImport[1]!, kind: "import", line: i + 1 });
        }
      } else {
        const imp = /^\s*import\s[^'"]*['"]([^'"]+)['"]/.exec(line);
        const exp = /^\s*export\s[^'"]*from\s*['"]([^'"]+)['"]/.exec(line);
        const req = /^\s*(?:const|let|var)\s[^=]+=\s*require\(\s*['"]([^'"]+)['"]/.exec(line);
        const dyn = /^\s*(?:const|let)?\s*\w*\s*=?\s*await\s+import\(\s*['"]([^'"]+)['"]/.exec(line);
        if (imp) imports.push({ source: imp[1]!, kind: "import", line: i + 1 });
        else if (exp) imports.push({ source: exp[1]!, kind: "import", line: i + 1 });
        else if (req) imports.push({ source: req[1]!, kind: "require", line: i + 1 });
        else if (dyn) imports.push({ source: dyn[1]!, kind: "import", line: i + 1 });

        // Real export-name lists.
        const exportList = /^\s*export\s*\{([^}]*)\}/.exec(line);
        if (exportList && symbols.length < 900) {
          for (const name of exportList[1]!.split(",")) {
            const clean = name.trim().split(/\s+as\s+/).pop()?.trim();
            if (clean) {
              symbols.push({ name: clean, kind: "variable", line: i + 1, column: 1 });
            }
          }
        }
      }
    }

    /* ---- constructs ---- */
    if (constructs.length < 400) {
      const route = isTsLike ? ROUTE_PATTERN.exec(trimmed) : null;
      if (route) {
        constructs.push({
          kind: "route",
          name: route[1]!,
          line: i + 1,
          endLine: findBlockEnd(lines, i + 1),
          detail: trimmed.slice(0, 100),
        });
      }
      const api = API_CALL_PATTERN.exec(line);
      if (api) constructs.push({ kind: "api-call", name: api[1]!, line: i + 1 });
      const db = DB_PATTERN.exec(line);
      if (db) constructs.push({ kind: "database", name: db[0]!.slice(0, 80), line: i + 1 });
      const env = ENV_PATTERN.exec(line);
      if (env) constructs.push({ kind: "env-reference", name: env[1]!, line: i + 1 });
      const zod = isTsLike ? ZOD_SCHEMA_PATTERN.exec(trimmed) : null;
      if (zod) constructs.push({ kind: "schema", name: zod[1]!, line: i + 1 });
      const test = TEST_PATTERN.exec(trimmed);
      if (test) constructs.push({ kind: "test", name: test[1]!, line: i + 1 });
    }

    /* ---- symbols ---- */
    if (!scanSymbols) continue;
    if (isPython) {
      for (const { re, kind } of PY_SYMBOL_PATTERNS) {
        const match = re.exec(line);
        if (match?.[1]) {
          symbols.push({
            name: match[1],
            kind,
            line: i + 1,
            column: (match.index ?? 0) + 1,
            detail: trimmed.slice(0, 80),
            endLine: kind === "class" ? findBlockEnd(lines, i + 1) : undefined,
          });
          break;
        }
      }
      continue;
    }

    let matched = false;
    for (const { re, kind } of TS_SYMBOL_PATTERNS) {
      const match = re.exec(line);
      if (match?.[1]) {
        const endLine =
          kind === "class" || kind === "function" ? findBlockEnd(lines, i + 1) : undefined;
        symbols.push({
          name: match[1],
          kind,
          line: i + 1,
          column: (match.index ?? 0) + 1,
          detail: trimmed.slice(0, 80),
          endLine,
        });
        matched = true;
        break;
      }
    }
    if (!matched && isTsLike && symbols.length < 900) {
      const component = COMPONENT_PATTERN.exec(line);
      if (component?.[1]) {
        const endLine = findBlockEnd(lines, i + 1);
        symbols.push({
          name: component[1],
          kind: "component",
          line: i + 1,
          column: (component.index ?? 0) + 1,
          detail: trimmed.slice(0, 80),
          endLine,
        });
        if (constructs.length < 400) {
          constructs.push({ kind: "component", name: component[1], line: i + 1, endLine });
        }
      }
    }
    if (isTsLike && symbols.length < 900) {
      const hook = HOOK_PATTERN.exec(line);
      if (hook?.[1] && constructs.length < 400) {
        constructs.push({ kind: "hook", name: hook[1], line: i + 1 });
      }
    }
  }

  return {
    symbols: symbols.slice(0, 1000),
    imports: imports.slice(0, 500),
    constructs: constructs.slice(0, 400),
    engine: "structural-scan",
    scannedLines: scanCount,
  };
}

/**
 * Tokenize text for retrieval (Phase 7): identifier-aware splitting that
 * preserves technical meaning — camelCase / snake_case / kebab-case parts
 * plus the original tokens, lowercased, minimal length filter.
 */
export function tokenizeForRetrieval(text: string): string[] {
  const raw = text
    .toLowerCase()
    .split(/[^a-z0-9_+#.]+/)
    .filter((t) => t.length >= 2 && t.length <= 64);
  const out: string[] = [];
  for (const token of raw) {
    out.push(token);
    if (/[a-z][A-Z]/.test(token)) {
      for (const part of token.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ")) {
        if (part.length >= 2) out.push(part.toLowerCase());
      }
    }
    if (token.includes("_") || token.includes("-")) {
      for (const part of token.split(/[_-]/)) {
        if (part.length >= 2) out.push(part);
      }
    }
  }
  return out;
}
