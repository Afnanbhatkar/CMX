import { db } from "@/lib/db";
import {
  readWorkspaceMeta,
  type WorkspaceMeta,
} from "@/lib/server/repository-fs";
import { ApiError } from "@/server/api/envelope";
import { logError } from "@/server/security/logger";

/**
 * CodeMind X V2 — repository registry service (Phase 3, spec §4).
 *
 * Merges two REAL sources, never one pretending to be the other:
 * - the persisted repository registry (SQLite `repositories` table), and
 * - the live workspace meta (real project name + real git branch via
 *   src/lib/server/repository-fs.ts, the same logic /api/repository/meta uses).
 *
 * Note: Repository's public identifier is its unique `slug` (schema decision
 * from Task 3-b); lookups therefore accept id OR slug — there is no separate
 * publicId column on this model.
 */

export interface RepositoryDTO {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  defaultBranch: string | null;
  /** "connected" | "indexing" | "unavailable" (schema vocabulary). */
  status: string;
  sourcePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RepositoryWorkspaceMeta = WorkspaceMeta["repository"];

export interface RepositoryListResult {
  repositories: RepositoryDTO[];
  workspace: RepositoryWorkspaceMeta;
}

/** Row type straight from the Prisma delegate (avoids importing Prisma namespace). */
type RepositoryRow = Awaited<ReturnType<typeof db.repository.findFirst>> & object;

function toDto(row: RepositoryRow): RepositoryDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    defaultBranch: row.defaultBranch,
    status: row.status,
    sourcePath: row.sourcePath,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function registryUnavailable(error: unknown, operation: string): ApiError {
  logError(`repository-service: ${operation} failed`, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
  return new ApiError("SERVICE_UNAVAILABLE", "Repository registry is unavailable.", 503);
}

/** List up to `take` repositories (newest first) merged with live workspace meta. */
export async function listRepositories(options?: {
  take?: number;
}): Promise<RepositoryListResult> {
  let rows: RepositoryRow[];
  try {
    rows = (await db.repository.findMany({
      take: options?.take ?? 50,
      orderBy: { createdAt: "desc" },
    })) as RepositoryRow[];
  } catch (error) {
    throw registryUnavailable(error, "list");
  }

  const meta = await readWorkspaceMeta();
  return {
    repositories: rows.map(toDto),
    workspace: meta.repository,
  };
}

/** Find one repository by id OR public slug; ApiError(REPOSITORY_NOT_FOUND) if absent. */
export async function findRepositoryByIdentifier(
  identifier: string,
): Promise<RepositoryDTO> {
  let row: RepositoryRow | null;
  try {
    row = (await db.repository.findFirst({
      where: { OR: [{ id: identifier }, { slug: identifier }] },
    })) as RepositoryRow | null;
  } catch (error) {
    throw registryUnavailable(error, "find");
  }

  if (!row) {
    throw new ApiError(
      "REPOSITORY_NOT_FOUND",
      "No repository matches the given identifier.",
      404,
    );
  }
  return toDto(row);
}
