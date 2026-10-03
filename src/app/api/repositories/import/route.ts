import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { withApi } from "@/server/api/with-api";
import { ApiError, jsonOk } from "@/server/api/envelope";
import { db } from "@/lib/db";
import { enqueueJob } from "@/server/jobs/queue";
import { serializeJob } from "@/server/jobs/serialize";
import { INGESTION_CONFIG } from "@/server/ingestion/config";
import { vaultSet } from "@/server/ingestion/token-vault";
import {
  validateGitHubUrl,
  validateGitUrl,
  validateLocalPath,
  validatePatternList,
  validateRef,
  validateSparsePaths,
} from "@/server/ingestion/url-validation";

/**
 * CodeMind X V2 — repository import API (Phase 4, spec §1/§2/§7).
 *
 * POST /api/repositories/import
 *   Body (JSON): { kind: "github"|"git"|"local", url?|path?, ref?, token?,
 *                  sparsePaths?, ignorePatterns?, includePatterns?, force?, name? }
 *   → 202 { data: { jobId, note } } — the import runs as a "repository.import"
 *   job; HTTP NEVER blocks on a clone (spec §2).
 *
 * Token handling (spec §1): the request token (or CODEMIND_GITHUB_TOKEN when
 * the request carries none — request wins) is held in the process-ephemeral
 * vault ONLY. It is stripped from AnalysisJob.input (persisted JSON) and
 * never persisted, logged, or echoed.
 * GitHub OAuth app authorization is [PLANNED] — token auth only in this
 * phase (mirrored in the response `note`).
 *
 * GET /api/repositories/import            → provenance list of IMPORTED
 *   repositories (sourceKind/sourceUrl/sourceRef/sourcePath/clonedSha —
 *   fields the Phase 3 /api/repositories DTO does not expose).
 * GET /api/repositories/import?jobId=<id> → the import job's chain link
 *   { chainedJobId, repositoryId, repositorySlug } from its finalizing
 *   checkpoint — the UI uses this to follow the chained repository.index job.
 *
 * NOTE: recovery of interrupted jobs is intentionally NOT triggered at route
 * load here — the job queue's own lazy init runs it once per process with a
 * staleness cutoff (see src/server/jobs/recovery.ts), so dev-server worker
 * processes cannot repeatedly re-queue each other's live jobs.
 */

export const dynamic = "force-dynamic";

const importSchema = z.object({
  kind: z.enum(["github", "git", "local"]),
  url: z.string().max(INGESTION_CONFIG.maxUrlLength).optional(),
  path: z.string().max(1024).optional(),
  ref: z.string().max(INGESTION_CONFIG.maxRefLength).optional(),
  token: z.string().max(4096).optional(),
  name: z.string().max(200).optional(),
  sparsePaths: z.array(z.string()).optional(),
  ignorePatterns: z.array(z.string()).optional(),
  includePatterns: z.array(z.string()).optional(),
  force: z.boolean().optional(),
});

export const POST = withApi(
  async (req, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApiError("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const parsed = importSchema.parse(body);

    // NOTE: `parsed.token` is deliberately NOT part of the persisted input.
    const { token, ...persisted } = parsed;

    /* Synchronous validation → honest 422 envelopes before any job exists. */
    let sourceUrl: string | null = null;
    if (parsed.kind === "github") {
      sourceUrl = validateGitHubUrl(parsed.url ?? "").sanitizedUrl;
    } else if (parsed.kind === "git") {
      sourceUrl = validateGitUrl(parsed.url ?? "").sanitizedUrl;
    } else {
      const check = validateLocalPath(parsed.path ?? "");
      const stat = await fs.stat(check.absolute).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        throw new ApiError("VALIDATION_ERROR", "path does not exist or is not a directory.", 422);
      }
      sourceUrl = check.absolute;
    }

    const ref = parsed.ref ? validateRef(parsed.ref) : undefined;
    const sparsePaths = validateSparsePaths(parsed.sparsePaths);
    const ignorePatterns = validatePatternList(parsed.ignorePatterns, "ignorePatterns");
    const includePatterns = validatePatternList(parsed.includePatterns, "includePatterns");

    /* Duplicate import → 409 unless force (spec matrix (d)/(e)). */
    if (!parsed.force) {
      const duplicate = await db.repository.findFirst({
        where: { sourceKind: parsed.kind, sourceUrl, sourceRef: ref ?? null },
        select: { id: true, slug: true },
      });
      if (duplicate) {
        throw new ApiError(
          "CONFLICT",
          `Repository already imported (slug "${duplicate.slug}"). Send force:true to re-import and re-index.`,
          409,
        );
      }
    }

    const row = await enqueueJob({
      type: "repository.import",
      input: {
        kind: parsed.kind,
        url: sourceUrl, // sanitized — no credentials possible here
        path: parsed.kind === "local" ? sourceUrl : undefined,
        ref,
        name: parsed.name,
        sparsePaths,
        ignorePatterns,
        includePatterns,
        force: parsed.force === true,
      },
    });

    // Token vault set AFTER enqueue (same task — the pump cannot reach the
    // handler before this line runs; run-to-run JS semantics guarantee it).
    if (token && token.trim().length > 0) {
      vaultSet(row.publicId, token.trim());
    }

    return jsonOk(
      {
        jobId: row.publicId,
        note: "Import runs as a repository.import job; a chained repository.index job follows. GitHub OAuth app authorization is [PLANNED] — token auth only. Tokens are never persisted or logged.",
      },
      { status: 202, requestId: ctx.requestId },
    );
  },
  { allowBody: true },
);

export const GET = withApi(async (req, ctx) => {
  const jobId = new URL(req.url).searchParams.get("jobId");

  if (jobId) {
    const row = await db.analysisJob.findUnique({ where: { publicId: jobId } });
    if (!row || row.type !== "repository.import") {
      throw new ApiError("NOT_FOUND", "No import job matches the given id.", 404);
    }
    let chainedJobId: string | null = null;
    let repositoryId: string | null = row.repositoryId;
    let repositorySlug: string | null = null;
    if (row.checkpoint) {
      try {
        const payload = JSON.parse(row.checkpoint) as {
          chained_job_id?: string;
          repository_id?: string | null;
          repository_slug?: string;
        };
        chainedJobId = payload.chained_job_id ?? null;
        repositoryId = payload.repository_id ?? repositoryId;
        repositorySlug = payload.repository_slug ?? null;
      } catch {
        // corrupt checkpoint → honest nulls
      }
    }
    return jsonOk(
      { ...serializeJob(row), chainedJobId, repositoryId, repositorySlug },
      { requestId: ctx.requestId },
    );
  }

  const rows = await db.repository.findMany({
    where: { sourceKind: { not: "workspace" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      defaultBranch: true,
      sourceKind: true,
      sourceUrl: true,
      sourceRef: true,
      sourcePath: true,
      clonedSha: true,
      createdAt: true,
    },
  });

  return jsonOk(
    {
      repositories: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      note: "Provenance view for imported repositories (sourceKind/sourceUrl/sourceRef). The generic /api/repositories DTO is owned by the Phase 3 service layer.",
    },
    { requestId: ctx.requestId },
  );
});
