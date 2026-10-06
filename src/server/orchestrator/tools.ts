/**
 * CodeMind X V2 — orchestrator tool layer (Phase 9 spec §4).
 *
 * EVERY tool call passes through `assertTool`, which checks the agent's
 * registry grants IN CODE. A tool result is plain data — it can never grant
 * new permissions, and no prompt can widen an agent's grant set (spec §4 +
 * V2.1: tool output must not be able to elevate privileges).
 *
 * Tools are thin adapters over the REAL services this build already uses
 * (hybrid search, workspace fs, read-only git service, static scanner).
 */

import {
  buildWorkspaceTree,
  isTextFile,
  readWorkspaceFile,
} from "@/lib/server/repository-fs";
import { getSearchIndex } from "@/server/search/index/search-index";
import {
  getCurrentBranch,
  getGitOverview,
  listRecentCommits,
} from "@/server/services/git-service";
import {
  runHybridSearch,
  type HybridSearchRequest,
  type SearchResponse,
} from "@/server/search/search-service";

import { allowedToolsFor, AGENT_SPECS } from "./registry";
import type { AgentName, Evidence, ToolName } from "./contracts";
import { runStaticSecurityScan, type StaticFinding } from "./security-scan";

/** Raised when an agent attempts a tool its contract does not grant. */
export class OrchestratorToolError extends Error {
  constructor(
    public agent: AgentName,
    public tool: ToolName,
  ) {
    super(
      `Permission denied: agent "${agent}" (${AGENT_SPECS[agent].label}) is not granted tool "${tool}"`,
    );
    this.name = "OrchestratorToolError";
  }
}

export interface ToolContext {
  agent: AgentName;
  signal?: AbortSignal;
  /** Observability hook — counts real tool usage per agent span. */
  onToolUse?: (tool: ToolName) => void;
}

function assertTool(ctx: ToolContext, tool: ToolName): void {
  if (!allowedToolsFor(ctx.agent).has(tool)) {
    throw new OrchestratorToolError(ctx.agent, tool);
  }
  ctx.onToolUse?.(tool);
}

/* ------------------------------------------------------------------ */
/* Repo tools (read/search only unless granted otherwise)              */
/* ------------------------------------------------------------------ */

export async function toolRepoSearch(
  ctx: ToolContext,
  request: HybridSearchRequest,
): Promise<SearchResponse> {
  assertTool(ctx, "repo.search");
  const { index } = await getSearchIndex();
  return runHybridSearch(index, request);
}

export async function toolReadFile(
  ctx: ToolContext,
  path: string,
): Promise<{ path: string; content: string; truncated: boolean } | null> {
  assertTool(ctx, "repo.read-file");
  const result = await readWorkspaceFile(path);
  if (!result.ok) return null;
  return {
    path: result.file.path,
    content: result.file.content,
    truncated: result.file.truncated,
  };
}

export interface TreeFileEntry {
  path: string;
  language: string;
}

export async function toolReadTree(ctx: ToolContext): Promise<TreeFileEntry[]> {
  assertTool(ctx, "repo.read-tree");
  const tree = await buildWorkspaceTree();
  const files: TreeFileEntry[] = [];
  const walk = (nodes: Awaited<ReturnType<typeof buildWorkspaceTree>>) => {
    for (const node of nodes) {
      if (node.type === "dir" && node.children) walk(node.children);
      else if (node.type === "file") files.push({ path: node.path, language: node.language ?? "" });
    }
  };
  walk(tree);
  return files;
}

/** Regex symbol scan over ALREADY-READ content (pure, no extra IO). */
export function toolSymbolScan(ctx: ToolContext, content: string): string[] {
  assertTool(ctx, "repo.symbol-scan");
  const symbols = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+class\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) symbols.add(match[1]);
    }
  }
  return [...symbols].slice(0, 40);
}

/* ------------------------------------------------------------------ */
/* Git tools (read-only; git.mutate is granted to NO ONE this phase)   */
/* ------------------------------------------------------------------ */

export interface GitReadView {
  branch: string | null;
  overview: Awaited<ReturnType<typeof getGitOverview>> | null;
}

export async function toolGitOverview(ctx: ToolContext): Promise<GitReadView> {
  assertTool(ctx, "git.read-overview");
  const [branch, overview] = await Promise.all([
    getCurrentBranch().catch(() => null),
    getGitOverview().catch(() => null),
  ]);
  return { branch, overview };
}

export async function toolGitCommits(
  ctx: ToolContext,
  maxCount = 10,
): Promise<Awaited<ReturnType<typeof listRecentCommits>>> {
  assertTool(ctx, "git.read-commits");
  return listRecentCommits(maxCount).catch(() => []);
}

/* ------------------------------------------------------------------ */
/* Static analysis / graph / dependency tools                          */
/* ------------------------------------------------------------------ */

export async function toolSecurityScan(
  ctx: ToolContext,
  scopedPaths: string[] | null,
): Promise<{ findings: StaticFinding[]; filesScanned: number }> {
  assertTool(ctx, "static.security-scan");
  return runStaticSecurityScan(scopedPaths, ctx.signal);
}

export interface ImportGraphView {
  nodes: string[];
  edges: { from: string; to: string }[];
  hubs: { path: string; fanIn: number }[];
  cycles: string[][];
  unresolved: number;
}

const IMPORT_RE =
  /(?:import\s+[^'" ]*\s*from\s*|import\s*\(\s*|require\s*\(\s*|export\s+[^'" ]*\s*from\s*)["']([^"']+)["']/g;

const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", "/index.ts", "/index.tsx"];

function resolveRelative(fromFile: string, spec: string, known: Set<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const dir = fromFile.split("/").slice(0, -1).join("/");
  const parts = `${dir}/${spec}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const base = stack.join("/");
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** Build the real import graph over the given files (reads them). */
export async function toolImportGraph(
  ctx: ToolContext,
  scopedPaths: string[] | null,
): Promise<ImportGraphView> {
  assertTool(ctx, "graph.import-graph");
  const files =
    scopedPaths && scopedPaths.length > 0
      ? scopedPaths
      : (await toolReadTree({ ...ctx, agent: ctx.agent }))
          .filter((f) => isTextFile(f.path))
          .map((f) => f.path)
          .slice(0, 120);

  const known = new Set(files);
  const nodes = files;
  const edges: { from: string; to: string }[] = [];
  let unresolved = 0;

  const contents = await Promise.all(
    files.map(async (path) => ({ path, content: await toolReadFile(ctx, path) })),
  );
  const contentByPath = new Map<string, string>();
  for (const entry of contents) {
    if (entry.content) contentByPath.set(entry.path, entry.content.content);
  }

  for (const [from, content] of contentByPath) {
    if (ctx.signal?.aborted) break;
    for (const match of content.matchAll(IMPORT_RE)) {
      const spec = match[1];
      if (!spec || spec.startsWith("@/") || spec.startsWith("~")) {
        // internal alias — resolve to src/<rest>
        const base = spec.replace(/^@[~/]\//, "src/");
        let hit = false;
        for (const suffix of RESOLVE_SUFFIXES) {
          if (known.has(`${base}${suffix}`)) {
            edges.push({ from, to: `${base}${suffix}` });
            hit = true;
            break;
          }
        }
        if (!hit) unresolved += 1;
        continue;
      }
      const resolved = resolveRelative(from, spec, known);
      if (resolved) edges.push({ from, to: resolved });
      else if (!spec.startsWith(".")) continue; // external package — not a graph node
      else unresolved += 1;
    }
  }

  // fan-in hubs
  const fanIn = new Map<string, number>();
  for (const edge of edges) fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);
  const hubs = [...fanIn.entries()]
    .map(([path, count]) => ({ path, fanIn: count }))
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 5);

  // cycle detection (DFS over the built edge set)
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const dfs = (node: string) => {
    if (visited.has(node) || cycles.length >= 3) return;
    visiting.add(node);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      if (visiting.has(next)) {
        const idx = stack.indexOf(next);
        if (idx >= 0) cycles.push([...stack.slice(idx), next]);
      } else {
        dfs(next);
      }
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of nodes) dfs(node);

  return { nodes, edges, hubs, cycles, unresolved };
}

export interface DependencyScanView {
  declared: string[];
  used: string[];
  declaredUnused: string[];
  usedUndeclared: string[];
  filesScanned: number;
}

/** Cross-check declared package.json deps against real import usage. */
export async function toolDependencyScan(ctx: ToolContext): Promise<DependencyScanView> {
  assertTool(ctx, "deps.scan");
  const pkg = await toolReadFile(ctx, "package.json");
  const declared: string[] = [];
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      declared.push(...Object.keys(parsed.dependencies ?? {}));
      declared.push(...Object.keys(parsed.devDependencies ?? {}));
    } catch {
      // malformed package.json — report honestly below
    }
  }

  const files = (await toolReadTree(ctx))
    .filter((f) => isTextFile(f.path) && f.path.startsWith("src/"))
    .map((f) => f.path)
    .slice(0, 200);

  const used = new Set<string>();
  let filesScanned = 0;
  for (const path of files) {
    if (ctx.signal?.aborted) break;
    const content = await toolReadFile(ctx, path);
    if (!content) continue;
    filesScanned += 1;
    for (const match of content.content.matchAll(IMPORT_RE)) {
      const spec = match[1];
      if (!spec) continue;
      if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("~") || spec.startsWith("node:")) continue;
      const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (name) used.add(name);
    }
  }

  const declaredSet = new Set(declared);
  const usedArr = [...used].sort();
  return {
    declared: declared.sort(),
    used: usedArr,
    declaredUnused: declared.filter((d) => !used.has(d)),
    usedUndeclared: usedArr.filter((u) => !declaredSet.has(u)),
    filesScanned,
  };
}

/* ------------------------------------------------------------------ */
/* Evidence helpers                                                    */
/* ------------------------------------------------------------------ */

/** Build a piece of evidence from a real file + line (snippet trimmed). */
export function evidenceFrom(
  path: string,
  content: string | null,
  line: number | null,
  why: string,
): Evidence {
  let snippet = "";
  if (content && line && line > 0) {
    const lines = content.split("\n");
    snippet = (lines[line - 1] ?? "").trim().slice(0, 240);
  }
  return { path, line, snippet, why };
}
