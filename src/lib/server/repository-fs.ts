/**
 * CodeMind X V2 — server-side repository filesystem access.
 *
 * Real, read-only access to the workspace project files with strict
 * allowlisting (RULES.md §3 trust boundaries):
 * - only whitelisted roots (source tree + key configs) are exposed
 * - secrets and databases (.env*, /db, uploads, tool results…) are excluded
 * - path traversal, dotfiles, binaries and oversized files are rejected
 * - directory listings are depth- and size-capped, tree cached briefly
 *
 * These APIs make the Phase 2 workspace shell REAL (tree, tabs, editor)
 * without implementing the later-phase repository engine (indexing,
 * search ranking, git intelligence) — those remain [PLANNED].
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

import type { RepoTreeNode } from "@/features/workspace/types";

/** Large-file policy (V2.1 ADDITIONS §A/§E) — matches the model manager. */
export const LARGE_FILE_BYTES = 512 * 1024;
/** Hard ceiling for the editor path (bytes) — above this the tab is too-large. */
export const MAX_EDITOR_FILE_BYTES = 6 * 1024 * 1024;

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = process.cwd();

/** Workspace-relative roots exposed to the UI. Everything else is denied. */
const ALLOWED_ROOTS = [
  "src",
  "prisma/schema.prisma",
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "components.json",
  "eslint.config.mjs",
  "postcss.config.mjs",
  "tailwind.config.ts",
  "README.md",
  // Agent Mode V2 (spec §124): files the agent creates must show up in the
  // repository explorer and open in the editor — examples/ (and any other
  // conventional top-level output folders) are part of the workspace.
  "examples",
  "tests",
  "scripts",
  "docs",
] as const;

/** Directories never listed, even if found inside allowed roots. */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".turbo",
  "coverage",
]);

const EXCLUDED_FILES = new Set([".DS_Store"]);

const MAX_TREE_ENTRIES = 2000;
const MAX_TREE_DEPTH = 12;
const MAX_FILE_BYTES = 512 * 1024; // 512 KB
const TREE_CACHE_MS = 30_000;

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".md": "markdown",
  ".mdx": "markdown",
  ".prisma": "prisma",
  ".sh": "bash",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".svg": "xml",
  ".txt": "text",
  // Agent Mode V2: the workspace can now contain files the agent creates in
  // other languages — they must be readable, editable and validatable.
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".sql": "sql",
  ".ini": "ini",
  ".cfg": "text",
  ".xml": "xml",
};

/* ------------------------------------------------------------------ */
/* Path safety                                                         */
/* ------------------------------------------------------------------ */

export type PathCheckResult =
  | { ok: true; absolute: string; relative: string }
  | { ok: false };

/**
 * Normalize + allowlist a workspace-relative path.
 * Rejects traversal, absolute escapes, dotfiles and non-allowed roots.
 */
export function resolveAllowedPath(input: string): PathCheckResult {
  if (typeof input !== "string") return { ok: false };
  const cleaned = input.trim().replace(/\\/g, "/");
  if (!cleaned || cleaned.length > 512) return { ok: false };
  if (cleaned.includes("\0")) return { ok: false };

  const absolute = path.resolve(PROJECT_ROOT, cleaned);
  // Must stay inside the project root.
  if (absolute !== PROJECT_ROOT && !absolute.startsWith(PROJECT_ROOT + path.sep)) {
    return { ok: false };
  }
  const relative = path.relative(PROJECT_ROOT, absolute).replace(/\\/g, "/");
  if (!relative || relative.startsWith("..")) return { ok: false };

  // No path segment may be a traversal or a hidden file/dir.
  const segments = relative.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") return { ok: false };
    if (seg.startsWith(".")) return { ok: false };
  }

  // Must live under one of the allowed roots.
  const allowed = ALLOWED_ROOTS.some((root) => {
    const absRoot = path.resolve(PROJECT_ROOT, root);
    return absolute === absRoot || absolute.startsWith(absRoot + path.sep);
  });
  if (!allowed) return { ok: false };

  return { ok: true, absolute, relative };
}

/* ------------------------------------------------------------------ */
/* Tree                                                                */
/* ------------------------------------------------------------------ */

let treeCache: { at: number; tree: RepoTreeNode[] } | null = null;

/** Per-directory subtree cache (Phase 5 lazy loading) — same 30s TTL. */
const subtreeCache = new Map<string, { at: number; children: RepoTreeNode[] }>();

function compareEntries(a: RepoTreeNode, b: RepoTreeNode): number {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

export function languageForPath(p: string): string {
  return LANGUAGE_BY_EXT[extOf(p)] ?? "text";
}

/** True when the extension is a known text language (route-level policy uses this). */
export function isTextFile(name: string): boolean {
  return extOf(name) in LANGUAGE_BY_EXT;
}

/**
 * Walk result: the sorted children plus whether the listing was CUT by the
 * depth/entry caps. `cut` lets the caller mark the owning dir node
 * `truncated: true` so the UI can lazy-load the remainder (Phase 5).
 */
interface WalkResult {
  nodes: RepoTreeNode[];
  cut: boolean;
}

async function walkDir(
  absDir: string,
  relDir: string,
  depth: number,
  budget: { count: number },
): Promise<WalkResult> {
  if (depth > MAX_TREE_DEPTH || budget.count > MAX_TREE_ENTRIES) {
    return { nodes: [], cut: true }; // children exist but were not listed
  }
  let dirents;
  try {
    dirents = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return { nodes: [], cut: false }; // unreadable dir — honestly empty, not cut
  }
  const dirs: RepoTreeNode[] = [];
  const files: RepoTreeNode[] = [];
  let cut = false;

  for (const dirent of dirents) {
    if (budget.count >= MAX_TREE_ENTRIES) {
      cut = true; // entry cap reached mid-listing — remaining children cut
      break;
    }
    if (dirent.name.startsWith(".") || EXCLUDED_DIRS.has(dirent.name) || EXCLUDED_FILES.has(dirent.name)) {
      continue;
    }
    budget.count += 1;
    const childAbs = path.join(absDir, dirent.name);
    const childRel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
    if (dirent.isDirectory()) {
      const sub = await walkDir(childAbs, childRel, depth + 1, budget);
      const node: RepoTreeNode = {
        path: childRel,
        name: dirent.name,
        type: "dir",
        children: sub.nodes,
      };
      if (sub.cut) node.truncated = true; // per-dir flag: children were cut
      dirs.push(node);
    } else if (dirent.isFile()) {
      files.push({
        path: childRel,
        name: dirent.name,
        type: "file",
        language: languageForPath(dirent.name),
      });
    }
  }

  dirs.sort(compareEntries);
  files.sort(compareEntries);
  return { nodes: [...dirs, ...files], cut };
}

/** Build the real workspace tree (allowlisted roots only). Cached 30s. */
export async function buildWorkspaceTree(): Promise<RepoTreeNode[]> {
  if (treeCache && Date.now() - treeCache.at < TREE_CACHE_MS) {
    return treeCache.tree;
  }
  const budget = { count: 0 };
  const roots: RepoTreeNode[] = [];

  for (const root of ALLOWED_ROOTS) {
    const abs = path.resolve(PROJECT_ROOT, root);
    try {
      const stat = await fs.stat(abs);
      if (stat.isDirectory()) {
        const sub = await walkDir(abs, root, 1, budget);
        const node: RepoTreeNode = {
          path: root,
          name: root,
          type: "dir",
          children: sub.nodes,
        };
        if (sub.cut) node.truncated = true;
        roots.push(node);
      } else if (stat.isFile()) {
        roots.push({ path: root, name: root, type: "file", language: languageForPath(root) });
      }
    } catch {
      // root not present in this project — skip it silently
    }
  }

  treeCache = { at: Date.now(), tree: roots };
  // Subtree caches share the whole-tree schedule: rebuilt listings invalidate them.
  subtreeCache.clear();
  return roots;
}

/* ------------------------------------------------------------------ */
/* Subtree (Phase 5 lazy loading)                                      */
/* ------------------------------------------------------------------ */

/**
 * Children of ONE allowlisted directory (Phase 5 lazy loading of truncated
 * dirs). Same depth/entry caps and dirs-first sort as buildWorkspaceTree;
 * cached per resolved path for 30s. Returns null when the path is outside
 * the allowlist or is not an existing directory — the route maps that to
 * 403/404. Never throws for filesystem reasons (unreadable dir → empty list).
 */
export async function buildWorkspaceSubtree(relativeDir: string): Promise<RepoTreeNode[] | null> {
  const check = resolveAllowedPath(relativeDir);
  if (!check.ok) return null;

  try {
    const stat = await fs.stat(check.absolute);
    if (!stat.isDirectory()) return null;
  } catch {
    return null; // not an existing directory under an allowed root
  }

  const cached = subtreeCache.get(check.relative);
  if (cached && Date.now() - cached.at < TREE_CACHE_MS) {
    return cached.children;
  }

  const budget = { count: 0 };
  const sub = await walkDir(check.absolute, check.relative, 1, budget);
  subtreeCache.set(check.relative, { at: Date.now(), children: sub.nodes });
  return sub.nodes;
}

/* ------------------------------------------------------------------ */
/* File reading                                                        */
/* ------------------------------------------------------------------ */

export type ReadFileResult =
  | {
      ok: true;
      file: {
        path: string;
        content: string;
        language: string;
        size: number;
        truncated: boolean;
        /** V2.1 §A/§E — true when the file opened through the large-file path. */
        largeFile: boolean;
      };
    }
  | { ok: false; code: "not-found" | "forbidden" | "too-large" | "binary" };

/**
 * Read a real workspace file (text only, size-capped, traversal-safe).
 * Large-file path (V2.1 §E): files between 512 KB and 6 MB load with
 * `largeFile: true` so the editor sheds expensive features instead of
 * freezing; above 6 MB the tab stays honestly "too-large".
 */
export async function readWorkspaceFile(input: string): Promise<ReadFileResult> {
  const check = resolveAllowedPath(input);
  if (!check.ok) return { ok: false, code: "forbidden" };

  let stat;
  try {
    stat = await fs.stat(check.absolute);
  } catch {
    return { ok: false, code: "not-found" };
  }
  if (!stat.isFile()) return { ok: false, code: "forbidden" };
  if (!isTextFile(path.basename(check.absolute))) return { ok: false, code: "binary" };
  if (stat.size > MAX_EDITOR_FILE_BYTES) return { ok: false, code: "too-large" };

  try {
    const buf = await fs.readFile(check.absolute);
    if (buf.subarray(0, 8192).includes(0)) return { ok: false, code: "binary" };
    const content = buf.toString("utf-8");
    return {
      ok: true,
      file: {
        path: check.relative,
        content,
        language: languageForPath(check.relative),
        size: stat.size,
        truncated: false,
        largeFile: stat.size > LARGE_FILE_BYTES,
      },
    };
  } catch {
    return { ok: false, code: "not-found" };
  }
}

/* ------------------------------------------------------------------ */
/* Meta                                                                */
/* ------------------------------------------------------------------ */

export interface WorkspaceMeta {
  repository: { connected: boolean; name: string; branch: string | null };
  indexing: { status: "unavailable"; note: string };
}

/** Real project name (package.json) + real git branch. Honest nulls on failure. */
export async function readWorkspaceMeta(): Promise<WorkspaceMeta> {
  let name = "workspace";
  try {
    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8"),
    ) as { name?: string };
    if (typeof pkg.name === "string" && pkg.name) name = pkg.name;
  } catch {
    // keep fallback name
  }

  let branch: string | null = null;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: PROJECT_ROOT, timeout: 3_000 },
    );
    const value = stdout.trim();
    if (value) branch = value;
  } catch {
    branch = null; // honest: git unavailable → "Not connected"
  }

  return {
    repository: { connected: true, name, branch },
    indexing: {
      status: "unavailable",
      note: "Repository indexing arrives in a later phase.",
    },
  };
}
