import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import {
  buildWorkspaceTree,
  languageForPath,
  readWorkspaceMeta,
} from "@/lib/server/repository-fs";
import { getCurrentBranch } from "@/server/services/git-service";
import { createEvent } from "@/server/events/types";
import { logError, logWarn } from "@/server/security/logger";
import type { RepoTreeNode } from "@/features/workspace/types";

import { discoverWorkspaceFiles } from "@/server/ingestion/discovery";
import { readMarker } from "@/server/ingestion/workspace";
import { runGit } from "@/server/ingestion/git-runner";
import { classifyFile } from "@/server/ingestion/classify";
import {
  CONTENT_HASH_ALGORITHM,
  INDEX_METADATA_VERSIONS,
  recordImportFindings,
  type ImportFindingKind,
  type SuspiciousEntry,
} from "@/server/ingestion/index-metadata";

import type { JobHandler } from "../types";

/**
 * CodeMind X V2 — the REAL repository index job (Phase 3, spec §5).
 *
 * Walks the actual workspace file tree (walker + ignore rules reused verbatim
 * from src/lib/server/repository-fs.ts — allowlisted roots, dotfiles and
 * excluded dirs never enter), upserts repository_files rows in chunks of 100,
 * persists a resumable checkpoint per chunk, and honors pause/cancel between
 * chunks. Memory stays bounded: file CONTENTS are never read (size via stat),
 * and only one chunk of paths is held at a time.
 *
 * Phase 4 — IMPORTED repositories: when the repository row carries an
 * ABSOLUTE sourcePath (isolated ingestion checkout under
 * .ingestion-workspaces/, sourceKind != "workspace"), the walk targets that
 * root via the ingestion discovery walker (same default ignores; the import's
 * effective ignore/include patterns are re-read from the workspace marker so
 * rows match exactly what discovery counted), language comes from the local
 * ingestion map, and the branch/head come from git inside the checkout (git
 * runner with the sanitized env — workspace branch detection is untouched).
 * Resume contract is IDENTICAL for both modes: checkpoint { indexed, lastPath }.
 *
 * Phase 5 — V2.1 TRUST METADATA: every run creates ONE RepositoryIndexSnapshot
 * (ref/commit + pipeline versions) and every file upsert now carries
 * contentHash (real sha256 of the bytes on disk — null when unreadable, never
 * fabricated), a classification (informational only, see classify.ts), and the
 * snapshotId — completing the provenance chain repository → snapshot → file.
 * Discovery suspicious entries (symlinks/unsafe paths) are persisted as
 * RepositoryImportFinding rows, idempotent per (repositoryId, jobId).
 *
 * Privacy contract (ARCHITECTURE.md §8): events carry the operational label
 * "Indexing repository files" and workspace-relative paths only — never file
 * contents, never model reasoning.
 *
 * Resume contract: the checkpoint is { indexed, lastPath }; on resume, files
 * sorting lexicographically at-or-before lastPath are skipped (upserts are
 * idempotent, so the boundary is safe against a crash between writes).
 */

const WORKSPACE_SLUG = "workspace";
const CHUNK_SIZE = 100;
const ACTIVITY_LABEL = "Indexing repository files";
const STAGE_INDEXING = "indexing-files";

/** Bytes read from each file head for the binary sniff + comment classifier. */
const HEAD_BYTES = 8 * 1024;
/** Text files at-or-below this size get a headText for classification. */
const HEAD_TEXT_MAX_BYTES = 512 * 1024;
/** Stream-buffer size for the sha256 pass (memory stays O(1) per file). */
const HASH_CHUNK_BYTES = 64 * 1024;
/** The exact reason string discovery.ts uses for skipped symlinks. */
const SYMLINK_REASON = "symlink not followed";

/** Flatten the real tree into workspace-relative file paths (dirs skipped). */
function flattenFiles(nodes: RepoTreeNode[], out: string[]): void {
  for (const node of nodes) {
    if (node.type === "dir") {
      flattenFiles(node.children ?? [], out);
    } else {
      out.push(node.path);
    }
  }
}

/** Best-effort Activity row transitions; logging must never break the job. */
async function markActivity(
  activityId: string,
  status: "done" | "error" | "pending",
): Promise<void> {
  try {
    await db.activity.update({
      where: { id: activityId },
      data: { status, endedAt: new Date() },
    });
  } catch (error) {
    logWarn("repository-index: activity update failed (job unaffected)", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

async function setRepositoryStatus(repositoryId: string, status: string): Promise<void> {
  try {
    await db.repository.update({ where: { id: repositoryId }, data: { status } });
  } catch (error) {
    logError("repository-index: repository status update failed", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

/** Real filesIndexed on the snapshot; guarded so status flow cannot break. */
async function setSnapshotFilesIndexed(snapshotId: string, filesIndexed: number): Promise<void> {
  try {
    await updateSnapshotFilesIndexedRaw(snapshotId, filesIndexed);
  } catch (error) {
    logWarn("repository-index: snapshot filesIndexed update failed (job unaffected)", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

/**
 * One streaming pass per file: sha256 hex of ALL bytes + the first HEAD_BYTES
 * (for the binary sniff / comment classifier). Memory O(1) — contents are
 * never held whole. On ANY read failure the hash is null (NEVER fabricated);
 * a head assembled from bytes actually read before the failure is kept (real
 * content). An empty file hashes to the real sha256 of the empty string.
 */
async function hashAndHead(
  fullPath: string,
): Promise<{ hash: string | null; head: Buffer | null }> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(fullPath, "r");
  } catch {
    return { hash: null, head: null }; // unreadable → honest nulls
  }
  try {
    const hash = createHash(CONTENT_HASH_ALGORITHM);
    const buffer = Buffer.alloc(HASH_CHUNK_BYTES);
    const headChunks: Buffer[] = [];
    let headBytes = 0;
    let position = 0;
    for (;;) {
      let bytesRead: number;
      try {
        const read = await handle.read(buffer, 0, buffer.length, position);
        bytesRead = read.bytesRead;
      } catch {
        // Failed mid-file: hash cannot be completed (null — never fabricated);
        // the head, if any, still holds bytes really read.
        return {
          hash: null,
          head: headBytes > 0 ? Buffer.concat(headChunks) : null,
        };
      }
      if (bytesRead <= 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (headBytes < HEAD_BYTES) {
        const take = Math.min(bytesRead, HEAD_BYTES - headBytes);
        headChunks.push(Buffer.from(chunk.subarray(0, take)));
        headBytes += take;
      }
      position += bytesRead;
    }
    return { hash: hash.digest("hex"), head: headBytes > 0 ? Buffer.concat(headChunks) : null };
  } finally {
    await handle.close();
  }
}

/** Map a discovery reason string to its finding kind (unknown → unsafe_path). */
function findingKindForReason(reason: string): ImportFindingKind {
  return reason === SYMLINK_REASON ? "symlink" : "unsafe_path";
}

/* ------------------------------------------------------------------ */
/* STALE-CLIENT BRIDGE (self-healing — Phase 4 audit/usage pattern)     */
/*                                                                      */
/* The long-running dev-server process keeps its globalThis PrismaClient */
/* from BEFORE this push, so the Phase 5 delegates are undefined        */
/* in-process. While that is true, the SAME real tables are written via */
/* raw SQL mirroring Prisma's own statements (epoch-millis datetimes,   */
/* ON CONFLICT upserts). Any process reload after `prisma generate`     */
/* self-heals to the clean delegate path — the probe is a property read. */
/* ------------------------------------------------------------------ */

/** False only while the in-process PrismaClient predates the Phase 5 push. */
function phase5ClientReady(): boolean {
  return typeof db.repositoryIndexSnapshot?.create === "function";
}

async function createSnapshotRow(input: {
  repositoryId: string;
  ref: string | null;
  commitSha: string | null;
  kind: string;
  parserVersion: string;
  chunkingVersion: string;
  embeddingVersion: string;
  contentHashAlgorithm: string;
}): Promise<{ id: string }> {
  if (phase5ClientReady()) {
    return db.repositoryIndexSnapshot.create({ data: { ...input, filesIndexed: 0 } });
  }
  const id = crypto.randomUUID();
  await db.$executeRawUnsafe(
    `INSERT INTO repository_index_snapshots
       (id, repositoryId, parentSnapshotId, ref, commitSha, kind, parserVersion,
        chunkingVersion, embeddingVersion, contentHashAlgorithm, filesIndexed, createdAt)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    id,
    input.repositoryId,
    input.ref,
    input.commitSha,
    input.kind,
    input.parserVersion,
    input.chunkingVersion,
    input.embeddingVersion,
    input.contentHashAlgorithm,
    Date.now(),
  );
  return { id };
}

async function updateSnapshotFilesIndexedRaw(snapshotId: string, filesIndexed: number): Promise<void> {
  if (phase5ClientReady()) {
    await db.repositoryIndexSnapshot.update({ where: { id: snapshotId }, data: { filesIndexed } });
    return;
  }
  await db.$executeRawUnsafe(
    `UPDATE repository_index_snapshots SET filesIndexed = ? WHERE id = ?`,
    filesIndexed,
    snapshotId,
  );
}

async function upsertRepositoryFileRow(input: {
  repositoryId: string;
  path: string;
  size: number;
  language: string;
  contentHash: string | null;
  classification: string | null;
  snapshotId: string;
}): Promise<void> {
  if (phase5ClientReady()) {
    await db.repositoryFile.upsert({
      where: { repositoryId_path: { repositoryId: input.repositoryId, path: input.path } },
      create: {
        repositoryId: input.repositoryId,
        path: input.path,
        isDir: false,
        size: input.size,
        language: input.language,
        contentHash: input.contentHash,
        classification: input.classification,
        snapshotId: input.snapshotId,
        lastIndexedAt: new Date(),
      },
      update: {
        size: input.size,
        language: input.language,
        contentHash: input.contentHash,
        classification: input.classification,
        snapshotId: input.snapshotId,
        lastIndexedAt: new Date(),
      },
    });
    return;
  }
  // Raw upsert — same statement shape Prisma itself emits (see dev.log).
  const now = Date.now();
  await db.$executeRawUnsafe(
    `INSERT INTO repository_files
       (id, repositoryId, path, isDir, size, language, contentHash, lastIndexedAt,
        snapshotId, classification, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (repositoryId, path) DO UPDATE SET
       size = ?, language = ?, contentHash = ?, lastIndexedAt = ?,
       snapshotId = ?, classification = ?, updatedAt = ?`,
    crypto.randomUUID(),
    input.repositoryId,
    input.path,
    input.size,
    input.language,
    input.contentHash,
    now,
    input.snapshotId,
    input.classification,
    now,
    now,
    input.size,
    input.language,
    input.contentHash,
    now,
    input.snapshotId,
    input.classification,
    now,
  );
}

/** Group mixed suspicious entries by finding kind (one insert per kind). */
function groupSuspicious(
  entries: SuspiciousEntry[],
): Array<{ kind: ImportFindingKind; entries: SuspiciousEntry[] }> {
  const groups = new Map<ImportFindingKind, SuspiciousEntry[]>();
  for (const entry of entries) {
    const kind = findingKindForReason(entry.reason);
    const list = groups.get(kind);
    if (list) list.push(entry);
    else groups.set(kind, [entry]);
  }
  return Array.from(groups, ([kind, groupEntries]) => ({ kind, entries: groupEntries }));
}

export const repositoryIndexJob: JobHandler = async (ctx) => {
  const { jobId, publicId, repositoryId, control, publish } = ctx;

  /* 1. Resolve the repository row. When the enqueue named an existing
   *    repository, index into it; otherwise upsert the canonical workspace
   *    row (slug "workspace") with the REAL project name from the meta
   *    service. Status "indexing" while the run is live. */
  let repo;
  if (repositoryId) {
    const existing = await db.repository.findUnique({ where: { id: repositoryId } });
    if (existing) {
      repo = await db.repository.update({
        where: { id: existing.id },
        data: { status: "indexing" },
      });
    }
  }
  if (!repo) {
    const meta = await readWorkspaceMeta();
    repo = await db.repository.upsert({
      where: { slug: WORKSPACE_SLUG },
      create: {
        name: meta.repository.name,
        slug: WORKSPACE_SLUG,
        status: "indexing",
        sourcePath: ".",
      },
      update: {
        name: meta.repository.name,
        status: "indexing",
        sourcePath: ".",
      },
    });
  }

  /* Imported repositories (Phase 4): absolute sourcePath = isolated checkout. */
  const imported =
    Boolean(repo.sourceKind && repo.sourceKind !== "workspace") &&
    Boolean(repo.sourcePath) &&
    path.isAbsolute(repo.sourcePath as string);

  try {
    /* PHASE 5: ONE provenance snapshot per run — ref/commit at index time
     * (honest nulls when unknown) + the pipeline versions in force. */
    const snapshot = await createSnapshotRow({
      repositoryId: repo.id,
      ref: repo.sourceRef ?? repo.defaultBranch ?? null,
      commitSha: repo.clonedSha ?? null,
      kind: "full",
      parserVersion: INDEX_METADATA_VERSIONS.parser,
      chunkingVersion: INDEX_METADATA_VERSIONS.chunking,
      embeddingVersion: INDEX_METADATA_VERSIONS.embedding,
      contentHashAlgorithm: CONTENT_HASH_ALGORITHM,
    });

    /* 2. Real file tree via the existing walker + ignore rules. */
    const files: string[] = [];
    const sizes = new Map<string, number>();
    const languages = new Map<string, string>();
    const binaries = new Map<string, boolean>();

    if (imported) {
      const root = repo.sourcePath as string;
      const marker = await readMarker(root);
      const discovery = await discoverWorkspaceFiles(root, {
        ignorePatterns: marker?.ignorePatterns,
        includePatterns: marker?.includePatterns,
      });
      for (const file of discovery.files) {
        files.push(file.path);
        sizes.set(file.path, file.size);
        languages.set(file.path, file.language);
        binaries.set(file.path, file.isBinary);
      }
      /* PHASE 5: honest observations from the walk → RepositoryImportFinding
       * rows (idempotent per repositoryId+jobId; never fails the job). */
      if (discovery.suspicious.length > 0) {
        await recordImportFindings({
          jobId: publicId,
          repositoryId: repo.id,
          findings: groupSuspicious(discovery.suspicious),
        });
      }
    } else {
      const tree = await buildWorkspaceTree();
      flattenFiles(tree, files);
    }
    // Lexicographic order makes the checkpoint boundary deterministic.
    files.sort();
    const total = files.length;

    /* 3. Real current branch → RepositoryBranch row (isDefault true). */
    let branch: string | null = null;
    if (imported) {
      const root = repo.sourcePath as string;
      try {
        const head = await runGit({
          args: ["rev-parse", "--abbrev-ref", "HEAD"],
          cwd: root,
          allowFileProtocol: true,
        });
        const value = head.stdout.trim();
        branch = value && value !== "HEAD" ? value : null; // detached checkout → honest null
      } catch {
        branch = null; // honest: git unavailable inside the checkout
      }
    } else {
      branch = await getCurrentBranch();
    }
    if (branch) {
      await db.repositoryBranch.upsert({
        where: { repositoryId_name: { repositoryId: repo.id, name: branch } },
        create: {
          repositoryId: repo.id,
          name: branch,
          isDefault: true,
          ...(imported && repo.clonedSha ? { headSha: repo.clonedSha } : {}),
        },
        update: { isDefault: true, ...(imported && repo.clonedSha ? { headSha: repo.clonedSha } : {}) },
      });
      await db.repository.update({
        where: { id: repo.id },
        data: { defaultBranch: branch },
      });
    }
    // Workspace headSha capture arrives with the git-intelligence phase —
    // honest null. Imported rows carry the real clonedSha from the import.

    /* 4. Resume: skip files at-or-before the checkpointed lastPath. */
    const previous = await db.analysisJob.findUnique({
      where: { id: jobId },
      select: { checkpoint: true },
    });
    let startIndex = 0;
    if (previous?.checkpoint) {
      try {
        const parsed = JSON.parse(previous.checkpoint) as { lastPath?: unknown };
        if (typeof parsed.lastPath === "string") {
          while (startIndex < files.length && files[startIndex] <= parsed.lastPath) {
            startIndex += 1;
          }
        }
      } catch {
        startIndex = 0; // corrupt checkpoint → honest fresh start
      }
    }

    /* Activity row + ACTIVITY_STARTED (kind "understanding" = repository
     * understanding/indexing in the contracts.ts vocabulary). */
    let activityId = crypto.randomUUID();
    try {
      const activity = await db.activity.create({
        data: {
          jobId,
          kind: "understanding",
          label: ACTIVITY_LABEL,
          status: "active",
          startedAt: new Date(),
        },
      });
      activityId = activity.id;
    } catch (error) {
      logWarn("repository-index: activity create failed (job unaffected)", {
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
    publish(
      createEvent({
        type: "ACTIVITY_STARTED",
        jobId: publicId,
        activityId,
        kind: "understanding",
        label: ACTIVITY_LABEL,
      }),
    );

    /* 5. Chunked upserts with cooperative pause/cancel between chunks. */
    let processed = startIndex;
    let lastPath: string | null = startIndex > 0 ? files[startIndex - 1] : null;
    let stopped: "paused" | "cancelled" | null = null;
    /** REAL count of file rows written under THIS snapshot (progress counts
     * skipped-vanished files too; filesIndexed must not). */
    let indexedCount = 0;

    for (let i = startIndex; i < files.length; i += CHUNK_SIZE) {
      if (await control.checkCancel()) {
        stopped = "cancelled";
        break;
      }
      if (await control.checkPause()) {
        stopped = "paused";
        break;
      }

      for (const relPath of files.slice(i, i + CHUNK_SIZE)) {
        let size = 0;
        let language: string;
        let fullPath: string;
        if (imported) {
          const known = sizes.get(relPath);
          if (known === undefined) {
            // File vanished between walk and write — skip it honestly.
            processed += 1; // keep progress/total consistent
            lastPath = relPath;
            continue;
          }
          size = known;
          language = languages.get(relPath) ?? "text";
          fullPath = path.join(repo.sourcePath as string, relPath);
        } else {
          fullPath = path.resolve(process.cwd(), relPath);
          try {
            size = (await fs.stat(fullPath)).size;
          } catch {
            // File vanished between walk and stat — skip it honestly.
            processed += 1; // keep progress/total consistent
            lastPath = relPath;
            continue;
          }
          language = languageForPath(relPath);
        }

        /* PHASE 5 provenance: real sha256 + 8 KB head in ONE streaming pass.
         * contentHash stays null when the file is unreadable (never
         * fabricated). Classification is informational only. */
        const { hash, head } = await hashAndHead(fullPath);
        const discoveryBinary = imported ? (binaries.get(relPath) ?? false) : false;
        const isBinary = discoveryBinary || (head !== null && head.includes(0));
        const headText =
          !isBinary && size <= HEAD_TEXT_MAX_BYTES && head !== null
            ? head.toString("utf8")
            : null;
        const classification = classifyFile(relPath, { isBinary, headText });

        await upsertRepositoryFileRow({
          repositoryId: repo.id,
          path: relPath,
          size,
          language,
          contentHash: hash,
          classification,
          snapshotId: snapshot.id,
        });
        indexedCount += 1;
        processed += 1;
        lastPath = relPath;
      }

      await control.progress(
        STAGE_INDEXING,
        total > 0 ? processed / total : 1,
        { indexed: processed, lastPath },
      );
      publish(
        createEvent({
          type: "REPOSITORY_INDEXING",
          jobId: publicId,
          filesIndexed: processed,
          totalFiles: total,
          currentPath: lastPath ?? undefined,
        }),
      );
    }

    /* 6. Terminal paths. */
    if (stopped === "paused") {
      // Resumable: leave the repository "indexing"; the activity row goes
      // back to "pending" (work incomplete, will be redone on resume).
      await setSnapshotFilesIndexed(snapshot.id, indexedCount);
      await markActivity(activityId, "pending");
      return;
    }
    if (stopped === "cancelled") {
      // Terminal: an incomplete index must not claim "connected".
      await setSnapshotFilesIndexed(snapshot.id, indexedCount);
      await markActivity(activityId, "pending");
      await setRepositoryStatus(repo.id, "unavailable");
      return;
    }

    // PHASE 5: the snapshot carries the REAL count of files written under it.
    await setSnapshotFilesIndexed(snapshot.id, indexedCount);
    await setRepositoryStatus(repo.id, "connected");
    await markActivity(activityId, "done");
    publish(
      createEvent({
        type: "ACTIVITY_COMPLETED",
        activityId,
        label: ACTIVITY_LABEL,
      }),
    );
  } catch (error) {
    // Real failure: the repository must not stay "indexing" forever.
    await setRepositoryStatus(repo.id, "unavailable");
    throw error; // the queue sanitizes + persists it on the job row
  }
};
