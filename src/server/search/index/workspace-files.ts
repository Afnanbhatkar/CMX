/**
 * CodeMind X V2 — Phase 7 workspace file enumeration for the search index.
 *
 * Reads the REAL workspace through the same trust boundary as every other
 * repository surface (repository-fs allowlist): src/**, prisma/schema.prisma,
 * package.json, tsconfig.json and the other whitelisted roots. No path
 * escapes the allowlist; secrets/dotfiles/binaries are excluded exactly as
 * elsewhere. Files above the editor large-file ceiling are indexed as
 * metadata-only entries (honest, with a note) — their content is never read.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { buildWorkspaceTree, languageForPath, LARGE_FILE_BYTES } from "@/lib/server/repository-fs";
import type { RepoTreeNode } from "@/features/workspace/types";

export interface IndexedFile {
  path: string;
  language: string;
  size: number;
  content: string | null;
  /** true when the file was NOT read (over the index read ceiling). */
  skippedContent: boolean;
  mtimeMs: number;
}

const MAX_INDEX_FILES = 4000;
const MAX_INDEX_TOTAL_BYTES = 40 * 1024 * 1024;
/** Files above this read cap are indexed as path-only entries. */
const MAX_READ_BYTES = LARGE_FILE_BYTES * 2; // 1 MB

function flatten(nodes: RepoTreeNode[], out: { path: string; language: string }[] = []) {
  for (const node of nodes) {
    if (node.type === "file") {
      out.push({ path: node.path, language: node.language ?? languageForPath(node.path) });
    } else if (Array.isArray(node.children) && node.children.length > 0) {
      flatten(node.children, out);
    }
  }
  return out;
}

export interface WorkspaceFilesResult {
  files: IndexedFile[];
  totalBytes: number;
  truncated: boolean;
}

/** Enumerate + read the indexable workspace (allowlist-respecting). */
export async function collectWorkspaceFiles(): Promise<WorkspaceFilesResult> {
  const tree = await buildWorkspaceTree();
  const entries = flatten(tree).slice(0, MAX_INDEX_FILES);

  const files: IndexedFile[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (const entry of entries) {
    if (files.length >= MAX_INDEX_FILES || totalBytes > MAX_INDEX_TOTAL_BYTES) {
      truncated = true;
      break;
    }
    const absolute = path.resolve(process.cwd(), entry.path);
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch {
      continue; // vanished between tree build and stat — skip honestly
    }
    if (!stat.isFile()) continue;

    const tooBigToRead = stat.size > MAX_READ_BYTES;
    let content: string | null = null;
    if (!tooBigToRead) {
      try {
        const buf = await fs.readFile(absolute);
        if (buf.subarray(0, 4096).includes(0)) continue; // binary — not indexable
        content = buf.toString("utf-8");
      } catch {
        content = null;
      }
    }
    files.push({
      path: entry.path,
      language: entry.language,
      size: stat.size,
      content,
      skippedContent: tooBigToRead || content === null,
      mtimeMs: stat.mtimeMs,
    });
    totalBytes += stat.size;
  }

  return { files, totalBytes, truncated };
}

/**
 * Cheap index-staleness signature: (path, mtimeMs, size) joined. Rebuilt on
 * every search request (a few hundred stats is sub-millisecond) so results
 * always reflect the CURRENT workspace.
 */
export async function workspaceSignature(): Promise<string> {
  const tree = await buildWorkspaceTree();
  const entries = flatten(tree).slice(0, MAX_INDEX_FILES);
  const parts: string[] = [];
  for (const entry of entries) {
    try {
      const stat = await fs.stat(path.resolve(process.cwd(), entry.path));
      parts.push(`${entry.path}:${Math.round(stat.mtimeMs)}:${stat.size}`);
    } catch {
      parts.push(`${entry.path}:gone`);
    }
  }
  return parts.join("|");
}
