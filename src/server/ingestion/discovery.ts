import fs from "node:fs/promises";
import path from "node:path";

import { INGESTION_CONFIG } from "./config";
import { IngestionError } from "./errors";
import { MAX_SUSPICIOUS_ENTRIES, type SuspiciousEntry } from "./index-metadata";

/**
 * CodeMind X V2 — repository file discovery (Phase 4, spec §2/§3/§4/§6).
 *
 * Streaming walk of an isolated workspace: contents are NEVER read into RAM
 * except a ≤64 KB binary sniff buffer per candidate file (spec §3). Memory
 * stays O(1) per entry; only the discovered-metadata list is accumulated
 * (bounded by maxFiles).
 *
 * Language detection uses a LOCAL extension map in the same style as
 * src/lib/server/repository-fs.ts `languageForPath` — deliberately NOT
 * imported (spec §2), and extended with common code extensions since
 * imported repositories are not limited to this project's stack.
 *
 * Ignore rules (spec §4) with INCLUDE-FIRST precedence, documented:
 *   1. If the path matches an includePatterns entry (re-include), the
 *      default skip set and ignorePatterns LOSE for that path — the walk
 *      descends and the file is discovered. This lets users rescue dirs
 *      like "docs/build" without weakening the whole default set.
 *   2. Otherwise the default skip set + request ignorePatterns decide.
 * Matching semantics (both lists): an exact pattern matches when the path
 * equals it OR lives under it (prefix segments); a "*" glob matches the
 * basename or the full path.
 */

/* ------------------------------------------------------------------ */
/* Language map (local copy, same style as repository-fs.ts)           */
/* ------------------------------------------------------------------ */

const LANGUAGE_BY_EXT: Record<string, string> = {
  // Same entries as src/lib/server/repository-fs.ts (kept in style-sync):
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
  // Superset for imported repositories (documented divergence):
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".rb": "ruby",
  ".scala": "scala",
  ".sql": "sql",
  ".xml": "xml",
  ".vue": "vue",
  ".svelte": "svelte",
  ".dart": "dart",
  ".lua": "lua",
  ".pl": "perl",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hs": "haskell",
  ".clj": "clojure",
  ".graphql": "graphql",
  ".proto": "protobuf",
  ".ini": "ini",
  ".cfg": "ini",
  ".env": "dotenv",
  ".make": "makefile",
  ".cmake": "cmake",
  ".gradle": "groovy",
  ".ipynb": "json",
  ".lock": "text",
};

/** Extensions that are binary by name (no sniff needed). */
const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".bmp", ".webp", ".tif", ".tiff",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".zip", ".gz", ".tgz", ".tar", ".bz2", ".xz", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a", ".class", ".jar", ".war", ".wasm", ".node",
  ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".wav", ".flac", ".ogg", ".webm",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".db", ".sqlite", ".sqlite3", ".pyc", ".pyo", ".pack", ".idx",
]);

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

export function languageForPath(p: string): string {
  return LANGUAGE_BY_EXT[extOf(p)] ?? "text";
}

/* ------------------------------------------------------------------ */
/* Pattern matching (spec §4)                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_IGNORES = [
  // VCS + package + build output
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".next",
  "vendor", // decision: included (rescuable via includePatterns, spec §4 "vendor?")
  // Logs
  "*.log",
  // Temp / OS noise
  "~$*", ".DS_Store", "Thumbs.db", "*.tmp", "*.swp",
  // CodeMind's own workspace marker lives here too — never indexed
  ".codemind-import.json",
] as const;

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`, "i");
}

function patternMatches(pattern: string, relPath: string): boolean {
  if (pattern.includes("*")) {
    const re = globToRegExp(pattern);
    const base = relPath.slice(relPath.lastIndexOf("/") + 1);
    return re.test(base) || re.test(relPath);
  }
  if (relPath === pattern) return true;
  return relPath.startsWith(pattern + "/");
}

function matchesAny(patterns: readonly string[], relPath: string): boolean {
  for (const pattern of patterns) {
    if (patternMatches(pattern, relPath)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Discovery walk                                                      */
/* ------------------------------------------------------------------ */

export interface DiscoveredFile {
  /** Workspace-relative path, forward slashes, validated (spec §6). */
  path: string;
  size: number;
  language: string;
  isBinary: boolean;
}

export interface DiscoverySkipped {
  symlinks: number;
  oversized: number;
  binary: number;
  ignored: number;
}

export interface DiscoveryResult {
  files: DiscoveredFile[];
  totalBytes: number;
  skipped: DiscoverySkipped;
  truncated: boolean;
  /**
   * PHASE 5: honest observations about entries that were refused during the
   * walk (skipped symlinks, unsafe relative paths). Capped at
   * MAX_SUSPICIOUS_ENTRIES — the skipped counters remain the authoritative
   * totals; this list is a bounded sample for findings/UX.
   */
  suspicious: SuspiciousEntry[];
}

export interface DiscoveryOptions {
  ignorePatterns?: string[];
  includePatterns?: string[];
  quotaBytes?: number;
  /** Called every ~25 entries: cooperative pause/cancel + progress hook. */
  onProgress?: (discovered: number, currentPath: string) => Promise<void>;
}

/** Unsafe relative path (spec §6): absolute, "..", NUL, drive letter, backslash tricks. */
export function isUnsafeRelativePath(relPath: string): boolean {
  if (/[\u0000-\u001f\u007f]/.test(relPath)) return true;
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return true;
  const segments = normalized.split("/").filter((s) => s.length > 0);
  return segments.some((s) => s === "." || s === "..");
}

export async function discoverWorkspaceFiles(
  rootDir: string,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const files: DiscoveredFile[] = [];
  const skipped: DiscoverySkipped = { symlinks: 0, oversized: 0, binary: 0, ignored: 0 };
  const suspicious: SuspiciousEntry[] = [];
  let totalBytes = 0;
  let truncated = false;
  const quota = options.quotaBytes ?? INGESTION_CONFIG.diskQuotaBytes;

  /** Bounded observations — counters stay authoritative, the list is a sample. */
  const noteSuspicious = (entry: SuspiciousEntry): void => {
    if (suspicious.length < MAX_SUSPICIOUS_ENTRIES) suspicious.push(entry);
  };

  const defaultIgnores = DEFAULT_IGNORES as readonly string[];
  const extraIgnores = options.ignorePatterns ?? [];
  const includes = options.includePatterns ?? [];

  const walk = async (dir: string, relDir: string, depth: number): Promise<void> => {
    if (depth > INGESTION_CONFIG.maxDepth) {
      truncated = true;
      return;
    }
    if (files.length >= INGESTION_CONFIG.maxFiles) {
      truncated = true;
      return;
    }
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — skip honestly
    }

    for (const dirent of dirents) {
      if (files.length >= INGESTION_CONFIG.maxFiles) {
        truncated = true;
        return;
      }
      const childRel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      if (isUnsafeRelativePath(childRel)) {
        // Cannot exist under a real workspace, but never trust the tree.
        skipped.ignored += 1;
        noteSuspicious({ path: childRel, reason: "unsafe relative path" });
        continue;
      }

      /* INCLUDE-FIRST precedence (spec §4): a re-include match beats any
       * default/extra skip for this path — dirs are descended, files kept. */
      const reIncluded = includes.length > 0 && matchesAny(includes, childRel);
      if (!reIncluded && matchesAny(defaultIgnores, childRel)) {
        skipped.ignored += 1;
        continue;
      }
      if (!reIncluded && extraIgnores.length > 0 && matchesAny(extraIgnores, childRel)) {
        skipped.ignored += 1;
        continue;
      }

      const fullPath = path.join(dir, dirent.name);

      // Symlinks are never followed out of the workspace (spec §6).
      if (dirent.isSymbolicLink()) {
        skipped.symlinks += 1;
        noteSuspicious({ path: childRel, reason: "symlink not followed" });
        continue;
      }

      if (dirent.isDirectory()) {
        await walk(fullPath, childRel, depth + 1);
        continue;
      }
      if (!dirent.isFile()) {
        skipped.ignored += 1;
        continue;
      }

      let size = 0;
      try {
        size = (await fs.stat(fullPath)).size;
      } catch {
        continue; // vanished mid-walk
      }

      if (totalBytes + size > quota) {
        throw new IngestionError(
          "DISK_QUOTA_EXCEEDED",
          `disk quota exceeded during discovery (limit ${Math.round(quota / (1024 * 1024))} MB).`,
        );
      }
      totalBytes += size;

      if (size > INGESTION_CONFIG.maxFileBytes) {
        // Skipped AND counted — explicitly NOT a job failure (spec §3/§8).
        skipped.oversized += 1;
        continue;
      }

      const ext = extOf(dirent.name);
      let isBinary = BINARY_EXTS.has(ext);
      if (!isBinary) {
        isBinary = await sniffBinary(fullPath);
      }
      if (isBinary) skipped.binary += 1;

      files.push({
        path: childRel,
        size,
        language: isBinary ? "binary" : languageForPath(childRel),
        isBinary,
      });

      if (options.onProgress && files.length % 25 === 0) {
        await options.onProgress(files.length, childRel);
      }
    }
  };

  await walk(rootDir, "", 1);
  return { files, totalBytes, skipped, truncated, suspicious };
}

/** ≤64KB NUL-byte sniff — the only file content ever read (spec §3/§6). */
async function sniffBinary(fullPath: string): Promise<boolean> {
  try {
    const handle = await fs.open(fullPath, "r");
    try {
      const buffer = Buffer.alloc(INGESTION_CONFIG.binarySniffBytes);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead).includes(0);
    } finally {
      await handle.close();
    }
  } catch {
    return false; // unreadable → let later stages decide honestly
  }
}
