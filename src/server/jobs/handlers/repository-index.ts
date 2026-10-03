import fs from "node:fs/promises";
import path from "node:path";

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
    /* 2. Real file tree via the existing walker + ignore rules. */
    const files: string[] = [];
    const sizes = new Map<string, number>();
    const languages = new Map<string, string>();

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
        } else {
          try {
            size = (await fs.stat(path.resolve(process.cwd(), relPath))).size;
          } catch {
            // File vanished between walk and stat — skip it honestly.
            processed += 1; // keep progress/total consistent
            lastPath = relPath;
            continue;
          }
          language = languageForPath(relPath);
        }
        await db.repositoryFile.upsert({
          where: { repositoryId_path: { repositoryId: repo.id, path: relPath } },
          create: {
            repositoryId: repo.id,
            path: relPath,
            isDir: false,
            size,
            language,
            lastIndexedAt: new Date(),
          },
          update: {
            size,
            language,
            lastIndexedAt: new Date(),
          },
        });
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
      await markActivity(activityId, "pending");
      return;
    }
    if (stopped === "cancelled") {
      // Terminal: an incomplete index must not claim "connected".
      await markActivity(activityId, "pending");
      await setRepositoryStatus(repo.id, "unavailable");
      return;
    }

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
