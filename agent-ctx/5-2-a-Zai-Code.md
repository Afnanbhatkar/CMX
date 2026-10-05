# Task 5-2-a — Phase 5 Task 2-a: V2.1 trust metadata backend + git-status/provenance services

Agent: Z.ai Code (Phase 5 backend agent 2-a)
Status: COMPLETED (live-verified end-to-end)
Scope touched: prisma/schema.prisma, src/server/ingestion/{index-metadata,classify,discovery,zip-extract}.ts,
src/server/jobs/handlers/{repository-index,repository-import}.ts, src/lib/server/{git-status,file-provenance}.ts.
No git commit, no dev-server restart. No files outside scope touched.

## Exact new exports (what parallel agents can rely on)

### src/server/ingestion/index-metadata.ts
```ts
export const INDEX_METADATA_VERSIONS = { parser: "parser/v1", chunking: "chunking/v1", embedding: "embedding/v1" } as const;
export const CONTENT_HASH_ALGORITHM = "sha256";
export type ContentClassification =
  | "repository_data" | "repository_documentation" | "repository_comment"
  | "repository_fixture" | "repository_generated_output";
export type SuspiciousEntry = { path: string; reason: string };
export const MAX_SUSPICIOUS_ENTRIES = 100;   // discovery/zip collection cap
export const MAX_FINDINGS_PER_JOB = 200;     // RepositoryImportFinding rows per job
export type ImportFindingKind = "symlink" | "zip_rejected_entry" | "unsafe_path" | "oversized";
export interface ImportFindingGroup { kind: ImportFindingKind; entries: SuspiciousEntry[] }
export async function recordImportFindings(input: {
  jobId: string; repositoryId?: string | null; findings: ImportFindingGroup[];
}): Promise<number>  // delete-before-insert per (repositoryId, jobId); NEVER throws
```

### src/server/ingestion/classify.ts
```ts
export interface ClassifyOptions { isBinary?: boolean; headText?: string | null }
export function classifyFile(relativePath: string, opts?: ClassifyOptions): ContentClassification | null
```
Precedence: generated_output → fixture → documentation → comment (needs headText, never binary, ≥60% of first ≤100 non-empty lines with comment token) → data → null. Spec-literal consequence: `SECURITY*` prefix matching means e.g. `SecurityPreview.tsx` classifies as documentation (documented, informational-only).

### src/lib/server/git-status.ts
```ts
export type WorkspaceGitStatus = "modified" | "added" | "deleted" | "untracked" | "renamed";
export interface GitStatusResult { ok: boolean; status: Record<string, WorkspaceGitStatus>;
  branch: string | null; headSha: string | null; reason?: string }
export async function readWorkspaceGitStatus(): Promise<GitStatusResult>   // never throws
export async function readWorkspaceHead(): Promise<{ branch: string | null; headSha: string | null }>  // 30s cache, never throws
```
Priority on XY pairs: D→deleted, A→added, R (and rare C)→renamed, `??`→untracked, else modified; renames key the NEW path; backslashes normalized.

### src/lib/server/file-provenance.ts
```ts
export type FileProvenanceGitStatus = WorkspaceGitStatus; // re-export of git-status union
export interface FileProvenance { path; language; size; truncated; binary; mimeType: string | null;
  gitStatus: FileProvenanceGitStatus | null; branch: string | null; commitSha: string | null; lastModifiedAt: string | null }
export async function readFileProvenance(relativePath: string): Promise<
  { ok: true; provenance: FileProvenance } | { ok: false; code: "not-found"|"forbidden"|"too-large"|"binary"|"error"; message?: string }>
export async function readFileHistory(relativePath: string, limit?: number): Promise<
  { ok: true; commits: Array<{sha;author;date;message}> } | { ok: false; code: "not-found"|"forbidden"|"error"; message?: string }>
```
Notes: `too-large`/`binary` are valid failure codes but provenance does NOT fail on binary/size — it reports them (`binary`, `truncated = size > 512KB`); at most 8KB is ever read. resolve-fail → provenance=`forbidden` (mirrors readWorkspaceFile), history=`not-found` (per spec). limit clamped 1..20 (default 20). lastModifiedAt = `git log -1 --format=%aI -- <path>`, 2s timeout, honest null.

## DB contract (schema pushed, tables live)
- `repository_index_snapshots`: one row per repository.index run (ref/commitSha honest nulls when unknown, kind "full", parser/chunking/embedding versions, filesIndexed = REAL count of rows written under the snapshot).
- `repository_import_findings`: kind/detailPath/note rows keyed by (repositoryId?, jobId=job publicId); idempotent delete-before-insert per job scope.
- `repository_files` new columns: contentHash (sha256 hex, null when unreadable — never fabricated), classification (null = ordinary source), snapshotId (SetNull on snapshot delete; @@index added).
- Provenance chain live-verified: workspace repo 228/228 files carry contentHash + snapshotId after one index run.

## Stale-client bridge (IMPORTANT for agents writing Phase 5 API/UI next)
The long-running dev-server process keeps its globalThis PrismaClient from BEFORE this push, so `db.repositoryIndexSnapshot` / `db.repositoryImportFinding` are undefined in-process until the next dev-server restart. repository-index.ts + index-metadata.ts contain a self-healing bridge (same pattern as Phase 4 audit/usage): when the delegate is missing, the SAME tables are written via raw SQL (epoch-millis datetimes, ON CONFLICT upserts). After any process restart the clean delegate path runs automatically. Do NOT remove the probes; they are one property read each (`phase5ClientReady()`).

## Cross-contract note for 5-2-c consumer
5-2-c's `FileProvenanceMeta` adds `classification` on top of my `FileProvenance`. Backend source of truth: `RepositoryFile.classification` (populated by the index job). The API/UI layer can join it by path (or extend the provenance route with a DB lookup) — my service matches the task spec exactly and does not query the DB by design.

## Verification summary
- lint exit 0; tsc --noEmit: 0 errors under src/ (only pre-existing examples/websocket socket.io errors).
- db:push additive (backup /tmp/custom-pre-phase5-1791045499.db); counts identical before/after at push time (repositories 1, repository_files 88, branches 1, jobs 3, checkpoints 3, activities 5, audit 13); new tables empty and present.
- Live probes: git-status ok:true with 15 real modified entries (branch main, headSha d8dbbdfc715a); provenance/history/classify matrices all correct (see worklog).
- Live job run 9db4171a… COMPLETED → snapshot row (filesIndexed 228) + 228 hashes + 11 classified + status back to "connected" (a transient stale-client FAILED run 16:51 was diagnosed and fixed by the bridge).
- Findings raw-SQL path probe-verified (delete `IS ?` + insert + cleanup); symlink-finding chain verified at code level only (sandbox blocks symlink creation).
