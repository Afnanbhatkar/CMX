import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";

import { logWarn } from "@/server/security/logger";

/**
 * CodeMind X V2 — index metadata constants + trust types (Phase 5, V2.1).
 *
 * Version pinning for the indexing pipeline: every RepositoryIndexSnapshot
 * row records which parser/chunking/embedding version produced it, so future
 * pipeline changes can be distinguished honestly in the data (re-index under
 * a bumped version rather than silently mixing vintages).
 *
 * Trust metadata rules (RULES.md §3/§9): classifications and findings are
 * INFORMATIONAL observations about repository content — they never make
 * content authoritative and are never treated as instructions.
 */

export const INDEX_METADATA_VERSIONS = {
  parser: "parser/v1",
  chunking: "chunking/v1",
  embedding: "embedding/v1",
} as const;

export const CONTENT_HASH_ALGORITHM = "sha256";

/**
 * Trust classification for an indexed file (informational only — never
 * authoritative). `null` means ordinary source code: unclassified, NOT
 * flagged, never a security signal by itself.
 */
export type ContentClassification =
  | "repository_data"
  | "repository_documentation"
  | "repository_comment"
  | "repository_fixture"
  | "repository_generated_output";

/** One honest observation about a repository entry (path + why noticed). */
export type SuspiciousEntry = { path: string; reason: string };

/** Cap on per-run suspicious entries collected by discovery/extraction. */
export const MAX_SUSPICIOUS_ENTRIES = 100;

/** Cap on RepositoryImportFinding rows written per job. */
export const MAX_FINDINGS_PER_JOB = 200;

export type ImportFindingKind =
  | "symlink"
  | "zip_rejected_entry"
  | "unsafe_path"
  | "oversized";

export interface ImportFindingGroup {
  kind: ImportFindingKind;
  entries: SuspiciousEntry[];
}

/**
 * False only while the in-process PrismaClient predates the Phase 5 push
 * (stale globalThis client — see the bridge notes in repository-index.ts).
 * Self-heals to the delegate path after any process reload.
 */
function phase5ClientReady(): boolean {
  return typeof db.repositoryImportFinding?.deleteMany === "function";
}

/** Persist one batch via raw SQL (stale-client bridge; epoch-millis datetimes). */
async function recordImportFindingsRaw(
  jobId: string,
  repositoryId: string | null,
  rows: Array<{ kind: ImportFindingKind; detailPath: string; note: string | null }>,
): Promise<void> {
  await db.$executeRawUnsafe(
    `DELETE FROM repository_import_findings WHERE jobId = ? AND repositoryId IS ?`,
    jobId,
    repositoryId,
  );
  const now = Date.now();
  for (const row of rows) {
    await db.$executeRawUnsafe(
      `INSERT INTO repository_import_findings (id, repositoryId, jobId, kind, detailPath, note, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      repositoryId,
      jobId,
      row.kind,
      row.detailPath,
      row.note,
      now,
    );
  }
}

/**
 * Persist findings for one job, idempotently: prior rows for the same
 * (repositoryId, jobId) scope are deleted before the insert so re-runs never
 * duplicate (delete-before-insert, capped at MAX_FINDINGS_PER_JOB). Accepts
 * mixed kinds as groups — ONE delete covers the whole batch. NEVER throws —
 * findings are observations and must not be able to fail a job (failures are
 * logged, not swallowed silently).
 *
 * `repositoryId` is null for findings observed before the repository row
 * exists (e.g. rejected zip entries during an import job).
 */
export async function recordImportFindings(input: {
  jobId: string;
  repositoryId?: string | null;
  findings: ImportFindingGroup[];
}): Promise<number> {
  const { jobId, repositoryId = null, findings } = input;
  const totalCount = findings.reduce((sum, group) => sum + group.entries.length, 0);
  if (totalCount === 0) return 0;

  const rows: Array<{
    kind: ImportFindingKind;
    detailPath: string;
    note: string | null;
  }> = [];
  for (const group of findings) {
    for (const entry of group.entries) {
      if (rows.length >= MAX_FINDINGS_PER_JOB) break;
      rows.push({
        kind: group.kind,
        detailPath: entry.path.slice(0, 1024),
        note: entry.reason.slice(0, 512),
      });
    }
  }
  if (rows.length === 0) return 0;

  try {
    if (phase5ClientReady()) {
      await db.repositoryImportFinding.deleteMany({
        where: { jobId, repositoryId: repositoryId ?? null },
      });
      await db.repositoryImportFinding.createMany({
        data: rows.map((row) => ({ repositoryId, jobId, ...row })),
      });
    } else {
      await recordImportFindingsRaw(jobId, repositoryId, rows);
    }
    return rows.length;
  } catch (error) {
    logWarn("index-metadata: recording import findings failed (job unaffected)", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return 0;
  }
}
