/**
 * CodeMind X V2 — Phase 7 code-aware search index (facade).
 *
 * Builds and caches the retrieval index over the REAL workspace:
 * - lexical: BM25 inverted index over file units + symbol-name units
 * - dense:   hashed n-gram vectors (embeddings swap-in point)
 * - symbols: tree of REAL constructs from the shared structure scanner
 * - graph:   import edges (resolved relative imports) → callers/callees
 * - git:     current branch, working-tree status, recent commit touches
 *
 * Caching: local in-memory singleton (the sanctioned cache for this app),
 * invalidated by a (path, mtime, size) signature of the whole tree — so a
 * search right after an edit re-indexes, and an unchanged workspace serves
 * instantly. The index reports its own build stats honestly.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { scanStructure } from "@/lib/code-intel/structure-scanner";
import { Bm25Index, tokenizeUnit } from "./bm25";
import { DENSE_DIM, embed } from "./dense";
import { collectWorkspaceFiles, workspaceSignature, type IndexedFile } from "./workspace-files";

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface IndexedSymbol {
  name: string;
  kind: string;
  path: string;
  line: number;
  endLine?: number;
  detail?: string;
}

export interface IndexedConstruct {
  kind: string;
  name: string | null;
  path: string;
  line: number;
  endLine?: number;
}

export interface ImportEdge {
  /** Source file path. */
  from: string;
  /** Resolved target file path (workspace-relative) when resolvable. */
  to: string | null;
  /** The raw import specifier. */
  specifier: string;
  line: number;
}

export interface GitContext {
  branch: string | null;
  /** Real repository identity — basename of the git top-level (V2.1 query contract). */
  repository: string | null;
  /** path → working-tree status (porcelain). */
  status: Map<string, string>;
  /** Recently touched paths (last 200 commits, name-only). */
  recentPaths: Set<string>;
}

export interface SearchIndexStats {
  files: number;
  bytes: number;
  symbols: number;
  constructs: number;
  importEdges: number;
  resolvedEdges: number;
  /** Total indexed tokens across lexical units. */
  lexicalUnits: number;
  buildMs: number;
  builtAt: string;
  truncated: boolean;
  denseDim: number;
  /** language → file count (real distribution, powers the filter UI). */
  languages: Record<string, number>;
}

export interface SearchIndex {
  signature: string;
  files: IndexedFile[];
  /** File path → L2-normalized dense vector. */
  vectors: Map<string, Float32Array>;
  lexical: Bm25Index;
  symbols: IndexedSymbol[];
  constructs: IndexedConstruct[];
  graph: ImportEdge[];
  git: GitContext;
  stats: SearchIndexStats;
  /** Content line lookup for snippet extraction. */
  contentOf(path: string): string[] | null;
}

/* ------------------------------------------------------------------ */
/* Import resolution                                                   */
/* ------------------------------------------------------------------ */

const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", "/index.ts", "/index.tsx", "/index.js"];

function resolveImport(specifier: string, fromPath: string, fileSet: Set<string>): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  let base: string;
  if (specifier.startsWith("@/")) {
    base = `src/${specifier.slice(2)}`;
  } else {
    const fromDir = path.posix.dirname(fromPath);
    base = path.posix.normalize(path.posix.join(fromDir, specifier));
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Git context (cheap, cached with the index)                          */
/* ------------------------------------------------------------------ */

async function readGitContext(): Promise<GitContext> {
  const context: GitContext = {
    branch: null,
    repository: null,
    status: new Map(),
    recentPaths: new Set(),
  };
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: process.cwd(),
      timeout: 3_000,
    });
    context.branch = stdout.trim() || null;
  } catch {
    context.branch = null;
  }
  try {
    // Real repository identity (V2.1 search query contract): the basename of
    // the git top-level directory — not a fabricated label.
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      timeout: 3_000,
    });
    const toplevel = stdout.trim();
    context.repository = toplevel ? toplevel.split("/").pop() ?? null : null;
  } catch {
    context.repository = null;
  }
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
      timeout: 3_000,
    });
    for (const line of stdout.split("\n")) {
      if (line.length < 4) continue;
      const status = line.slice(0, 2).trim();
      const file = line.slice(3).trim().replace(/^"|"$/g, "").replace(/ -> .*$/, "");
      if (file) context.status.set(file, status);
    }
  } catch {
    // git status unavailable — honest empty map
  }
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-n", "200", "--name-only", "--pretty=format:"],
      { cwd: process.cwd(), timeout: 4_000 },
    );
    for (const file of stdout.split("\n")) {
      const clean = file.trim();
      if (clean) context.recentPaths.add(clean);
    }
  } catch {
    // honest empty set
  }
  return context;
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

const MAX_LINES_PER_FILE = 20_000;

async function buildIndex(signature: string): Promise<SearchIndex> {
  const started = performance.now();
  const { files, totalBytes, truncated } = await collectWorkspaceFiles();
  const fileSet = new Set(files.map((f) => f.path));

  const lexical = new Bm25Index();
  const vectors = new Map<string, Float32Array>();
  const symbols: IndexedSymbol[] = [];
  const constructs: IndexedConstruct[] = [];
  const graph: ImportEdge[] = [];
  let resolvedEdges = 0;
  const contents = new Map<string, string[]>();
  const idfCounts = new Map<string, number>();

  const scanCache = new Map<string, ReturnType<typeof scanStructure>>();

  for (const file of files) {
    if (!file.content) continue; // metadata-only entry
    const scan = scanStructure(file.content, file.language);
    scanCache.set(file.path, scan);

    // Symbol/construct tables (real — from the scan of real content).
    for (const symbol of scan.symbols) {
      symbols.push({
        name: symbol.name,
        kind: symbol.kind,
        path: file.path,
        line: symbol.line,
        endLine: symbol.endLine,
        detail: symbol.detail,
      });
    }
    for (const construct of scan.constructs) {
      constructs.push({
        kind: construct.kind,
        name: construct.name,
        path: file.path,
        line: construct.line,
        endLine: construct.endLine,
      });
    }

    // Lexical units: the whole file + one unit per named symbol.
    const tokens = tokenizeUnit(file.content);
    for (const token of tokens.keys()) idfCounts.set(token, (idfCounts.get(token) ?? 0) + 1);
    const lines = file.content.split("\n", MAX_LINES_PER_FILE);
    contents.set(file.path, lines);
    lexical.add({
      id: `file:${file.path}`,
      path: file.path,
      tokens,
      length: tokens.size,
      lines: [{ start: 1, end: lines.length }],
      kind: "file",
    });

    // Import graph edges (real import statements).
    for (const imp of scan.imports) {
      const resolved = resolveImport(imp.source, file.path, fileSet);
      if (resolved) resolvedEdges += 1;
      graph.push({ from: file.path, to: resolved, specifier: imp.source, line: imp.line });
    }
  }

  // Symbol-name units (name match = strong signal).
  for (const symbol of symbols.slice(0, 8000)) {
    const tokens = tokenizeUnit(symbol.name);
    if (tokens.size === 0) continue;
    lexical.add({
      id: `sym:${symbol.path}:${symbol.line}:${symbol.name}`,
      path: symbol.path,
      tokens,
      length: tokens.size,
      lines: [{ start: symbol.line, end: symbol.endLine ?? symbol.line }],
      kind: "symbol",
    });
  }

  // Dense vectors (idf-weighted from lexical document frequency).
  const N = Math.max(1, files.length);
  const idf = (token: string): number => {
    const df = idfCounts.get(token) ?? 0;
    return df === 0 ? 1 : Math.log(1 + N / df);
  };
  for (const file of files) {
    if (!file.content) continue;
    const window = file.content.length > 64_000 ? file.content.slice(0, 64_000) : file.content;
    vectors.set(file.path, embed(window, idf));
  }

  const git = await readGitContext();

  const languages: Record<string, number> = {};
  for (const file of files) {
    languages[file.language] = (languages[file.language] ?? 0) + 1;
  }

  const stats: SearchIndexStats = {
    files: files.length,
    bytes: totalBytes,
    symbols: symbols.length,
    constructs: constructs.length,
    importEdges: graph.length,
    resolvedEdges,
    lexicalUnits: lexical.docCount,
    buildMs: Math.round(performance.now() - started),
    builtAt: new Date().toISOString(),
    truncated,
    denseDim: DENSE_DIM,
    languages,
  };

  return {
    signature,
    files,
    vectors,
    lexical,
    symbols,
    constructs,
    graph,
    git,
    stats,
    contentOf(p: string): string[] | null {
      return contents.get(p) ?? null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Cached singleton                                                    */
/* ------------------------------------------------------------------ */

let cached: SearchIndex | null = null;
let inflight: Promise<SearchIndex> | null = null;

export interface FreshIndex {
  index: SearchIndex;
  /** true when the cached index was rebuilt for this request. */
  rebuilt: boolean;
}

/** Get the current index — rebuilds when the workspace signature changed. */
export async function getSearchIndex(): Promise<FreshIndex> {
  const signature = await workspaceSignature();
  if (cached && cached.signature === signature) {
    return { index: cached, rebuilt: false };
  }
  if (!inflight) {
    inflight = buildIndex(signature)
      .then((index) => {
        cached = index;
        return index;
      })
      .finally(() => {
        inflight = null;
      });
  }
  const index = await inflight;
  return { index, rebuilt: true };
}

/** Index statistics without forcing a rebuild (honest "not built" state). */
export function peekIndexStats(): SearchIndexStats | null {
  return cached?.stats ?? null;
}

/** mtime reader used by staleness checks in tests. */
export async function statMtime(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(path.resolve(process.cwd(), filePath));
    return stat.mtimeMs;
  } catch {
    return null;
  }
}
