import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

import { INGESTION_ROOT } from "./config";
import { INGESTION_CONFIG } from "./config";

/**
 * CodeMind X V2 — isolated ingestion workspaces (Phase 4, spec §5/§6).
 *
 * Every import materializes into `<projectRoot>/.ingestion-workspaces/<uuid>/`
 * — a dot-directory OUTSIDE the UI's allowlisted tree, git-ignored, and the
 * ONLY place imported bytes are ever written.
 *
 * Marker file (spec §5): `<workspace>/.codemind-import.json`
 *   { token, jobId, sourceKind, sourceUrl-sanitized, createdAt }
 * The checkpoint_token generated at job start is persisted here; resume
 * after restart compares the AnalysisCheckpoint payload's checkpoint_token
 * against this marker (match → skip cloning; mismatch → start fresh).
 *
 * Extra marker fields (documented additions): sparseFingerprint +
 * effective ignore/include patterns — the chained repository.index job reads
 * them so its re-walk matches exactly what discovery counted, and the
 * incremental-fetch path matches workspaces by (kind, url, fingerprint).
 */

export const MARKER_FILE = ".codemind-import.json";

export interface ImportMarker {
  /** checkpoint_token (uuid) generated at job start — spec §5. */
  token: string;
  /** AnalysisJob.publicId of the job that created the workspace. */
  jobId: string;
  /** "github" | "git" | "zip" | "local" */
  sourceKind: string;
  /** Credential-free source URL (null/absent for zip). */
  sourceUrl?: string;
  createdAt: string;
  /** Fingerprint of the sparse checkout set ("" when full checkout). */
  sparseFingerprint?: string;
  /** Effective ignore/include patterns used by discovery (chained index reuses them). */
  ignorePatterns?: string[];
  includePatterns?: string[];
  /** Repository display name derived at import time. */
  name?: string;
}

/** Stable fingerprint for the sparse checkout set (order-sensitive). */
export function sparseFingerprint(paths?: string[]): string {
  if (!paths || paths.length === 0) return "";
  return createHash("sha256").update(paths.join("\n")).digest("hex").slice(0, 16);
}

export async function ensureIngestionRoot(): Promise<void> {
  await fs.mkdir(INGESTION_ROOT, { recursive: true });
}

/** Create a fresh isolated workspace directory; returns its absolute path. */
export async function createWorkspace(): Promise<string> {
  await ensureIngestionRoot();
  const dir = path.join(INGESTION_ROOT, randomUUID());
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeMarker(workspacePath: string, marker: ImportMarker): Promise<void> {
  await fs.writeFile(path.join(workspacePath, MARKER_FILE), JSON.stringify(marker, null, 2), "utf-8");
}

export async function readMarker(workspacePath: string): Promise<ImportMarker | null> {
  try {
    const raw = await fs.readFile(path.join(workspacePath, MARKER_FILE), "utf-8");
    const parsed = JSON.parse(raw) as ImportMarker;
    if (typeof parsed?.token !== "string" || typeof parsed?.jobId !== "string") return null;
    return parsed;
  } catch {
    return null; // missing/corrupt marker → honest "no resume data"
  }
}

export interface ExistingWorkspace {
  workspacePath: string;
  marker: ImportMarker;
}

/**
 * Find an existing isolated workspace for the SAME source (spec §3:
 * incremental fetch). Matching key: sourceKind + sanitized sourceUrl +
 * sparse fingerprint (ref deliberately NOT part of the key — a fetch +
 * reset covers ref changes). The workspace must still contain a .git dir
 * for git-sourced kinds. Scanning is shallow (depth-1 subdirs only).
 */
export async function findMatchingWorkspace(input: {
  sourceKind: string;
  sourceUrl?: string;
  sparseFingerprint: string;
}): Promise<ExistingWorkspace | null> {
  let dirents;
  try {
    dirents = await fs.readdir(INGESTION_ROOT, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const workspacePath = path.join(INGESTION_ROOT, dirent.name);
    const marker = await readMarker(workspacePath);
    if (!marker) continue;
    if (marker.sourceKind !== input.sourceKind) continue;
    if ((marker.sourceUrl ?? "") !== (input.sourceUrl ?? "")) continue;
    if ((marker.sparseFingerprint ?? "") !== input.sparseFingerprint) continue;
    if (input.sourceKind !== "zip") {
      try {
        const stat = await fs.stat(path.join(workspacePath, ".git"));
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
    }
    return { workspacePath, marker };
  }
  return null;
}

interface WalkTotals {
  bytes: number;
  files: number;
}

async function sumTree(dir: string, totals: WalkTotals, depth: number): Promise<void> {
  if (depth > INGESTION_CONFIG.maxDepth) return;
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of dirents) {
    // lstat semantics via withFileTypes + stat on the entry itself; symlinks
    // are counted at their link size (never followed out of the workspace).
    const full = path.join(dir, dirent.name);
    try {
      if (dirent.isSymbolicLink()) {
        const lstat = await fs.lstat(full);
        totals.bytes += lstat.size;
        totals.files += 1;
        continue;
      }
      if (dirent.isDirectory()) {
        await sumTree(full, totals, depth + 1);
        continue;
      }
      if (dirent.isFile()) {
        const stat = await fs.stat(full);
        totals.bytes += stat.size;
        totals.files += 1;
      }
    } catch {
      // vanished mid-walk — skip honestly
    }
  }
}

/** Running total of bytes under the workspace (cloned or extracted). */
export async function workspaceBytes(workspacePath: string): Promise<{ bytes: number; files: number }> {
  const totals: WalkTotals = { bytes: 0, files: 0 };
  await sumTree(workspacePath, totals, 0);
  return totals;
}

/** Best-effort recursive delete of an ingestion workspace (never throws). */
export async function removeWorkspace(workspacePath: string): Promise<void> {
  try {
    // Defense in depth: only ever delete inside the ingestion root.
    const resolved = path.resolve(workspacePath);
    if (!resolved.startsWith(path.resolve(INGESTION_ROOT) + path.sep)) return;
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 2 });
  } catch {
    // best-effort — the workspace scanner ignores unusable dirs anyway
  }
}

/**
 * Remove workspaces left behind by EARLIER attempts of the same import job
 * (marker.jobId === jobId). A crash mid-clone leaves a marker-only directory
 * that git clone can never reuse as a destination; deleting them keeps the
 * ingestion root clean across retries. Never throws.
 */
export async function removeWorkspacesForJob(jobId: string): Promise<void> {
  let dirents;
  try {
    dirents = await fs.readdir(INGESTION_ROOT, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const workspacePath = path.join(INGESTION_ROOT, dirent.name);
    const marker = await readMarker(workspacePath);
    if (marker && marker.jobId === jobId) {
      await removeWorkspace(workspacePath);
    }
  }
}
