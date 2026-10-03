import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { ApiError } from "@/server/api/envelope";
import { createEvent } from "@/server/events/types";
import { logError, logInfo, logWarn } from "@/server/security/logger";

import { INGESTION_CONFIG, INGESTION_UPLOAD_STAGING } from "../../ingestion/config";
import { ImportCancelledError, IngestionError } from "../../ingestion/errors";
import { runGit } from "../../ingestion/git-runner";
import { discoverWorkspaceFiles, isUnsafeRelativePath } from "../../ingestion/discovery";
import { redactSecret, sanitizeGitOutput, slugifyName } from "../../ingestion/sanitize";
import { vaultDelete, vaultPeek } from "../../ingestion/token-vault";
import {
  createWorkspace,
  findMatchingWorkspace,
  readMarker,
  removeWorkspace,
  removeWorkspacesForJob,
  sparseFingerprint,
  workspaceBytes,
  writeMarker,
  type ImportMarker,
} from "../../ingestion/workspace";
import { extractZipArchive, type ZipHardRejectError } from "../../ingestion/zip-extract";
import { recordImportFindings } from "../../ingestion/index-metadata";
import {
  validateGitHubUrl,
  validateGitUrl,
  validateLocalPath,
  validatePatternList,
  validateRef,
  validateSparsePaths,
  type UrlCheck,
} from "../../ingestion/url-validation";

import type { JobHandler } from "../types";

/**
 * CodeMind X V2 — repository IMPORT job (Phase 4, spec §1–§6/§8).
 *
 * Pipeline: validating → authenticating → cloning|extracting → discovering →
 * parsing → finalizing (Repository row + CHAINED repository.index job). The
 * HTTP routes return 202 immediately; cloning never blocks a request. Ingestion
 * is static: the only external binary is git (git-runner), no repository code
 * is ever executed.
 *
 * CHECKPOINT MODEL (spec §5) — the required checkpoint fields are mapped onto
 * the existing AnalysisCheckpoint persistence (queue control.progress →
 * upsert key "latest"):
 *   { repository_id, job_id, stage, current_file, processed_count,
 *     total_count, checkpoint_token, last_successful_operation }
 * plus documented additions (workspace_path, source_kind, source_url,
 * chained_job_id, repository_slug) needed for honest resume + UI lookup.
 * checkpoint_token is a fresh uuid per RUN and is mirrored into the marker
 * file `<workspace>/.codemind-import.json`. RESUME AFTER RESTART: on handler
 * start the persisted "latest" checkpoint is compared with the marker on
 * disk — matching token + stage past cloning/extracting skips the download
 * stage and continues from the checkpointed stage/counts; any mismatch
 * starts the stage fresh (honest).
 *
 * TOKEN HANDLING (spec §1): the request token rides the ephemeral in-process
 * vault (never AnalysisJob.input — that column is persisted JSON with
 * credentials stripped). The env token CODEMIND_GITHUB_TOKEN is read at job
 * time. Precedence: request token wins. After cloning, the origin remote is
 * reset to the SANITIZED url so no token ever lands in .git/config. Every
 * error/log is redacted via redactSecret.
 *
 * GitHub OAuth app authorization is [PLANNED] (spec §1) — token-based auth
 * only in this phase; the route response documents this.
 *
 * DUPLICATE/RE-IMPORT HONESTY (spec §8): fresh imports create the Repository
 * row only at finalizing (a failed import leaves no half-"connected" row).
 * A force re-import flips the EXISTING row to "indexing" up front and marks
 * it "unavailable" if this run fails — the previous snapshot is being
 * replaced, so claiming "connected" through a failing re-import would lie.
 */

type ImportKind = "github" | "git" | "local" | "zip";

interface ImportInput {
  kind: ImportKind;
  url?: string;
  path?: string;
  ref?: string;
  name?: string;
  zipPath?: string;
  sparsePaths?: string[];
  ignorePatterns?: string[];
  includePatterns?: string[];
  force?: boolean;
}

/** Stage names published on REPOSITORY_IMPORT events + the job row. */
const STAGE = {
  validating: "validating",
  authenticating: "authenticating",
  cloning: "cloning",
  extracting: "extracting",
  discovering: "discovering",
  parsing: "parsing",
  finalizing: "finalizing",
} as const;

/** Stages from which a restart can resume WITHOUT re-downloading. */
const RESUMABLE_STAGES = new Set<string>([
  STAGE.discovering,
  STAGE.parsing,
  STAGE.finalizing,
]);

interface ImportCheckpoint {
  repository_id: string | null;
  job_id: string;
  stage: string;
  current_file: string | null;
  processed_count: number;
  total_count: number;
  checkpoint_token: string;
  last_successful_operation: string;
  /* documented additions: */
  workspace_path?: string;
  source_kind?: ImportKind;
  source_url?: string | null;
  chained_job_id?: string;
  repository_slug?: string;
  files_discovered?: number;
  files_parsed?: number;
  files_binary?: number;
  files_oversized?: number;
  files_symlinks?: number;
  bytes_total?: number;
}

function isImportInput(value: unknown): ImportInput {
  if (typeof value !== "object" || value === null) {
    throw new IngestionError("INVALID_URL", "import job input is missing.");
  }
  return value as ImportInput;
}

/** Commit shas (7..40 hex) need a full clone — shallow+commit is unsupported upstream. */
function isCommitRef(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref);
}

/** Insert the ephemeral token into an https URL (never persisted, never logged). */
function authedUrl(check: UrlCheck, token: string | undefined, kind: ImportKind): string {
  if (!token) return check.sanitizedUrl;
  if (kind === "github") {
    return check.sanitizedUrl.replace("https://", `https://x-access-token:${token}@`);
  }
  return check.sanitizedUrl.replace("https://", `https://${token}@`);
}

export const repositoryImportJob: JobHandler = async (ctx) => {
  const { jobId, publicId, control, publish } = ctx;
  const input = isImportInput(ctx.input);

  const secrets: string[] = [];
  const kind = input.kind;

  const emit = (
    stage: keyof typeof STAGE,
    message: string,
    extra: { filesDiscovered?: number; filesParsed?: number; currentPath?: string } = {},
  ): void => {
    publish(
      createEvent({
        type: "REPOSITORY_IMPORT",
        jobId: publicId,
        stage: STAGE[stage],
        message: message.slice(0, 200),
        ...extra,
      }),
    );
  };

  const checkpoint = (
    stage: string,
    pct: number,
    fields: Partial<ImportCheckpoint> & Pick<ImportCheckpoint, "last_successful_operation">,
    base: ImportCheckpoint,
  ): Promise<void> =>
    control.progress(stage, pct, { ...base, stage, ...fields });

  let base: ImportCheckpoint = {
    repository_id: null,
    job_id: publicId,
    stage: STAGE.validating,
    current_file: null,
    processed_count: 0,
    total_count: 0,
    checkpoint_token: "",
    last_successful_operation: "job-started",
  };

  let workspacePath: string | null = null;
  let freshWorkspace = false;
  let repositoryRowId: string | null = null;
  /** Marker deferred until after the clone (git needs an EMPTY destination). */
  let markerRef: { path: string; marker: ImportMarker } | null = null;
  const kindUsesGit = kind === "github" || kind === "git" || kind === "local";

  try {
    /* ---------------- validating ---------------- */
    emit("validating", "Validating import request");
    await control.progress(STAGE.validating, 0.02);

    if (kind !== "github" && kind !== "git" && kind !== "local" && kind !== "zip") {
      throw new IngestionError("INVALID_URL", `unsupported import kind "${kind}".`);
    }

    const ref = input.ref ? validateRef(input.ref) : undefined;
    const sparsePaths = validateSparsePaths(input.sparsePaths);
    const ignorePatterns = validatePatternList(input.ignorePatterns, "ignorePatterns");
    const includePatterns = validatePatternList(input.includePatterns, "includePatterns");

    let urlCheck: UrlCheck | null = null;
    let localPath: string | null = null;
    let zipPath: string | null = null;

    if (kind === "github") {
      urlCheck = validateGitHubUrl(input.url ?? "");
    } else if (kind === "git") {
      urlCheck = validateGitUrl(input.url ?? "");
    } else if (kind === "local") {
      localPath = validateLocalPath(input.path ?? "").absolute;
    } else if (kind === "zip") {
      // The upload route staged the archive; validate containment (defense in
      // depth) — extraction guards live in zip-extract.ts.
      const staged = input.zipPath ?? "";
      const resolved = path.resolve(staged);
      if (!resolved.startsWith(path.resolve(INGESTION_UPLOAD_STAGING) + path.sep)) {
        throw new IngestionError("INVALID_ARCHIVE", "staged archive path is not inside the upload staging area.");
      }
      zipPath = resolved;
    }

    base = {
      ...base,
      checkpoint_token: randomUUID(),
      source_kind: kind,
      source_url: urlCheck?.sanitizedUrl ?? (localPath ?? null),
    };

    const fingerprint = sparseFingerprint(sparsePaths);

    /* ---------------- authenticating ----------------
     * Token PRESENCE check only — GitHub is never test-called (spec §2).
     * Precedence: request token (vault) wins over CODEMIND_GITHUB_TOKEN. */
    emit("authenticating", "Checking credentials");
    await control.progress(STAGE.authenticating, 0.05);

    let token: string | undefined;
    if (kind === "github" || kind === "git") {
      const requestToken = vaultPeek(publicId);
      const envToken =
        kind === "github" ? process.env[INGESTION_CONFIG.githubTokenEnv] : undefined;
      token = requestToken ?? envToken;
      if (token) secrets.push(token);
      emit(
        "authenticating",
        token ? "Token present — private repositories supported" : "No token — anonymous (public repositories only)",
      );
    } else if (kind === "zip") {
      emit("authenticating", "Archive import — no authentication required");
    } else {
      emit("authenticating", "Local import — no authentication required");
    }

    await checkpoint(STAGE.authenticating, 0.05, { last_successful_operation: "auth-presence-checked" }, base);

    /* ---------------- resume decision (spec §5) ----------------
     * Compare the persisted checkpoint with the marker file on disk. */
    let resumed = false;
    try {
      const previousRow = await db.analysisJob.findUnique({
        where: { id: jobId },
        select: { checkpoint: true },
      });
      if (previousRow?.checkpoint) {
        const previous = JSON.parse(previousRow.checkpoint) as ImportCheckpoint;
        if (
          previous.checkpoint_token &&
          previous.job_id === publicId &&
          typeof previous.workspace_path === "string" &&
          RESUMABLE_STAGES.has(previous.stage)
        ) {
          const marker = await readMarker(previous.workspace_path);
          if (marker && marker.token === previous.checkpoint_token && marker.jobId === publicId) {
            workspacePath = previous.workspace_path;
            freshWorkspace = false;
            base.checkpoint_token = previous.checkpoint_token;
            resumed = true;
            logInfo("ingestion: resuming from checkpoint", {
              jobId: publicId,
              stage: previous.stage,
            });
          }
        }
      }
    } catch (error) {
      // Corrupt checkpoint → honest fresh start (spec §5).
      logWarn("ingestion: checkpoint resume check failed; starting fresh", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    /* ---------------- cloning / extracting ---------------- */
    if (kind === "zip") {
      if (resumed) {
        emit("extracting", "Archive already extracted — continuing from checkpoint");
      } else {
        emit("extracting", "Extracting archive");
        await control.progress(STAGE.extracting, 0.05);

        workspacePath = await createWorkspace();
        freshWorkspace = true;
        const marker: ImportMarker = {
          token: base.checkpoint_token,
          jobId: publicId,
          sourceKind: kind,
          createdAt: new Date().toISOString(),
          sparseFingerprint: fingerprint,
          ignorePatterns,
          includePatterns,
          name: input.name,
        };
        await writeMarker(workspacePath, marker);

        const zipBytes = await fs.readFile(zipPath!);
        let result;
        try {
          result = await extractZipArchive(zipBytes, workspacePath, {
            quotaBytes: INGESTION_CONFIG.diskQuotaBytes,
          });
        } catch (error) {
          /* PHASE 5: refused archive entries are recorded as honest findings
           * before the failure propagates. repositoryId is null on first
           * imports (no repository row exists yet) — the jobId scope keeps
           * them queryable. Recording can never change the outcome. */
          const suspicious = (error as Partial<ZipHardRejectError>).suspicious;
          if (Array.isArray(suspicious) && suspicious.length > 0) {
            await recordImportFindings({
              jobId: publicId,
              repositoryId: null,
              findings: [{ kind: "zip_rejected_entry", entries: suspicious }],
            });
          }
          throw error;
        }
        zipBytes.fill(0); // release the archive buffer promptly
        await fs.rm(zipPath!, { force: true }).catch(() => undefined);

        emit("extracting", `Archive extracted (${result.filesWritten} files)`, {
          filesDiscovered: result.filesWritten,
        });
        await checkpoint(
          STAGE.extracting,
          0.4,
          {
            last_successful_operation: `archive-extracted:${result.filesWritten}-files`,
            workspace_path: workspacePath,
            processed_count: result.filesWritten,
          },
          base,
        );
      }
    } else if (kindUsesGit) {
      emit("cloning", resumed ? "Reusing existing checkout" : "Cloning repository");
      await control.progress(STAGE.cloning, 0.1);

      if (!resumed) {
        /* Incremental fetch: reuse an existing isolated workspace for the
         * SAME source (kind + sanitized url + sparse fingerprint). */
        const existing = await findMatchingWorkspace({
          sourceKind: kind,
          sourceUrl: urlCheck?.sanitizedUrl ?? localPath ?? undefined,
          sparseFingerprint: fingerprint,
        });

        const allowFile = kind === "local";
        if (existing) {
          workspacePath = existing.workspacePath;
          freshWorkspace = false;
          const sourceArg =
            kind === "local" ? `file://${localPath}` : authedUrl(urlCheck!, token, kind);
          await runGit({
            args: ["fetch", sourceArg, "--prune", "+refs/heads/*:refs/remotes/origin/*", "+refs/tags/*:refs/tags/*"],
            cwd: workspacePath,
            checkCancel: control.checkCancel,
            allowFileProtocol: allowFile,
            secret: token,
          });
          await resolveRefAndCheckout(workspacePath, ref, control.checkCancel, allowFile, token);
          emit("cloning", "Existing checkout updated (fetch + reset)");
        } else {
          /* Best-effort cleanup: workspaces left by EARLIER attempts of this
           * same job (crash mid-clone leaves a marker-only dir; git clone
           * refuses non-empty destinations, so those dirs are never reusable
           * and would otherwise leak on every retry). */
          await removeWorkspacesForJob(publicId);

          workspacePath = await createWorkspace();
          freshWorkspace = true;
          /*
           * MARKER TIMING (bug fixed in Phase 4 verification): the marker is
           * written AFTER the clone — git clone refuses non-empty destination
           * dirs, so pre-seeding the workspace with .codemind-import.json
           * broke every fresh clone. Resume consequence: a crash mid-clone
           * leaves no marker → the retry starts the clone fresh (honest per
           * spec §5 — no valid checkpoint existed past cloning anyway).
           */
          const marker: ImportMarker = {
            token: base.checkpoint_token,
            jobId: publicId,
            sourceKind: kind,
            sourceUrl: urlCheck?.sanitizedUrl ?? localPath ?? undefined,
            createdAt: new Date().toISOString(),
            sparseFingerprint: fingerprint,
            ignorePatterns,
            includePatterns,
          };
          markerRef = { path: workspacePath, marker };

          const sourceArg =
            kind === "local" ? `file://${localPath}` : authedUrl(urlCheck!, token, kind);

          if (ref && isCommitRef(ref)) {
            // Honest limitation: upstream git does not support shallow clones
            // of raw commits — a full clone is required here.
            await runGit({
              args: ["clone", sourceArg, workspacePath],
              checkCancel: control.checkCancel,
              allowFileProtocol: allowFile,
              secret: token,
            });
            await runGit({
              args: ["checkout", "-f", "--detach", ref],
              cwd: workspacePath,
              checkCancel: control.checkCancel,
              allowFileProtocol: allowFile,
              secret: token,
            });
          } else {
            const cloneArgs = ["clone"];
            if (ref) cloneArgs.push("--branch", ref);
            cloneArgs.push("--depth", "1", "--single-branch", sourceArg, workspacePath);
            await runGit({
              args: cloneArgs,
              checkCancel: control.checkCancel,
              allowFileProtocol: allowFile,
              secret: token,
            });
          }

          // Token hygiene: origin keeps the SANITIZED url — no credentials on disk.
          const originUrl = kind === "local" ? `file://${localPath}` : urlCheck!.sanitizedUrl;
          await runGit({
            args: ["remote", "set-url", "origin", originUrl],
            cwd: workspacePath,
            allowFileProtocol: allowFile,
            secret: token,
          }).catch((error) => {
            logWarn("ingestion: origin url sanitize failed (clone url stays ephemeral only)", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
          emit("cloning", "Repository cloned");
        }

        if (sparsePaths && sparsePaths.length > 0 && workspacePath) {
          await runGit({
            args: ["sparse-checkout", "set", "--no-cone", ...sparsePaths],
            cwd: workspacePath,
            checkCancel: control.checkCancel,
            allowFileProtocol: allowFile,
            secret: token,
          });
          emit("cloning", `Sparse checkout applied (${sparsePaths.length} prefixes)`);
        }
      }

      /* Marker: written only AFTER the checkout exists (see marker-timing
       * note above). From here on, a crash can resume from the checkpoint. */
      if (markerRef && !resumed) {
        await writeMarker(markerRef.path, markerRef.marker);
      }

      /* Post-clone honesty: real HEAD sha + disk usage against the quota. */
      const head = await runGit({
        args: ["rev-parse", "HEAD"],
        cwd: workspacePath!,
        checkCancel: control.checkCancel,
        allowFileProtocol: kind === "local",
        secret: token,
      });
      const clonedSha = head.stdout.trim();
      if (!/^[0-9a-f]{40}$/.test(clonedSha)) {
        throw new IngestionError("MALFORMED_REPOSITORY", "clone completed but HEAD sha could not be resolved.");
      }
      base.chained_job_id = undefined;
      await checkpoint(
        STAGE.cloning,
        0.4,
        {
          last_successful_operation: `clone-completed:${clonedSha.slice(0, 12)}`,
          workspace_path: workspacePath!,
          processed_count: 0,
          total_count: 0,
          current_file: null,
        },
        base,
      );

      const usage = await workspaceBytes(workspacePath!);
      if (usage.bytes > INGESTION_CONFIG.diskQuotaBytes) {
        throw new IngestionError(
          "DISK_QUOTA_EXCEEDED",
          `disk quota exceeded after clone (${Math.round(usage.bytes / (1024 * 1024))} MB; limit ${Math.round(INGESTION_CONFIG.diskQuotaBytes / (1024 * 1024))} MB).`,
        );
      }
    }

    if (await control.checkCancel()) return;
    if (await control.checkPause()) return;
    token = undefined; // auth material no longer needed past this point
    vaultDelete(publicId);

    /* ---------------- discovering ---------------- */
    emit("discovering", "Discovering files", resumed ? { filesDiscovered: 0 } : undefined);
    await control.progress(STAGE.discovering, 0.45);

    const discovery = await discoverWorkspaceFiles(workspacePath!, {
      ignorePatterns,
      includePatterns,
      quotaBytes: INGESTION_CONFIG.diskQuotaBytes,
      onProgress: async (discovered, current) => {
        emit("discovering", "Discovering files", { filesDiscovered: discovered, currentPath: current });
      },
    });

    emit("discovering", `Discovered ${discovery.files.length} files`, {
      filesDiscovered: discovery.files.length,
    });
    await checkpoint(
      STAGE.discovering,
      0.55,
      {
        last_successful_operation: `discovery-completed:${discovery.files.length}`,
        workspace_path: workspacePath!,
        processed_count: discovery.files.length,
        total_count: discovery.files.length,
        files_discovered: discovery.files.length,
        files_binary: discovery.skipped.binary,
        files_oversized: discovery.skipped.oversized,
        files_symlinks: discovery.skipped.symlinks,
        bytes_total: discovery.totalBytes,
      },
      base,
    );

    /* ---------------- parsing ----------------
     * Real per-file classification pass: re-validate every discovered path,
     * confirm size limits, and carry the (already computed) language/binary
     * classification forward. Symbol/chunk extraction is [PLANNED] — the
     * parse stage NEVER reads file contents (memory rule, spec §3). */
    emit("parsing", "Parsing files", { filesDiscovered: discovery.files.length });
    await control.progress(STAGE.parsing, 0.6);

    let parsedCount = 0;
    for (const file of discovery.files) {
      if (parsedCount % 50 === 0) {
        if (await control.checkCancel()) return;
        if (await control.checkPause()) return;
      }
      if (isUnsafeRelativePath(file.path)) {
        throw new IngestionError("MALFORMED_REPOSITORY", "a discovered path failed re-validation.");
      }
      parsedCount += 1;
      if (parsedCount % 25 === 0 || parsedCount === discovery.files.length) {
        emit("parsing", "Parsing files", {
          filesDiscovered: discovery.files.length,
          filesParsed: parsedCount,
          currentPath: file.path,
        });
        await checkpoint(
          STAGE.parsing,
          0.6 + 0.25 * (parsedCount / Math.max(1, discovery.files.length)),
          {
            last_successful_operation: `parsing:${parsedCount}`,
            current_file: file.path,
            processed_count: parsedCount,
            total_count: discovery.files.length,
            files_parsed: parsedCount,
          },
          base,
        );
      }
    }

    /* ---------------- finalizing ---------------- */
    emit("finalizing", "Creating repository record");
    await control.progress(STAGE.finalizing, 0.85);

    const displayName =
      input.name?.trim() ||
      (urlCheck?.githubPath ? `${urlCheck.githubPath.owner}/${urlCheck.githubPath.repo}` : null) ||
      (urlCheck ? decodeURIComponent(urlCheck.sanitizedUrl.replace(/\/+$/, "").split("/").pop() ?? "repository") : null) ||
      (localPath ? path.basename(localPath) : null) ||
      "imported repository";

    // Re-derive an existing row for force re-imports (route already checked).
    const existingRepo = (urlCheck?.sanitizedUrl ?? localPath)
      ? await db.repository.findFirst({
          where: {
            sourceKind: kind,
            sourceUrl: urlCheck?.sanitizedUrl ?? localPath ?? null,
            sourceRef: ref ?? null,
          },
        })
      : null;

    const slug = await allocateSlug(displayName, existingRepo?.id ?? null);

    const repo = existingRepo
      ? await db.repository.update({
          where: { id: existingRepo.id },
          data: {
            name: displayName,
            slug: existingRepo.slug,
            status: "indexing",
            sourcePath: workspacePath!,
            sourceKind: kind,
            sourceUrl: urlCheck?.sanitizedUrl ?? localPath ?? null,
            sourceRef: ref ?? null,
            clonedSha: null, // set below once known
          },
        })
      : await db.repository.create({
          data: {
            name: displayName,
            slug,
            status: "indexing",
            sourcePath: workspacePath!,
            sourceKind: kind,
            sourceUrl: urlCheck?.sanitizedUrl ?? localPath ?? null,
            sourceRef: ref ?? null,
          },
        });
    repositoryRowId = repo.id;

    const headSha = await runGit({
      args: ["rev-parse", "HEAD"],
      cwd: workspacePath!,
      allowFileProtocol: kind === "local",
    });
    await db.repository.update({ where: { id: repo.id }, data: { clonedSha: headSha.stdout.trim() } });

    /* Chained index job (spec §2): enqueue with repositoryId; the pump runs it
     * right after this job completes. Dynamic import keeps the module graph
     * acyclic (registry → this handler). */
    const { enqueueJob } = await import("../queue");
    const chained = await enqueueJob({ type: "repository.index", repositoryId: repo.id });

    await checkpoint(
      STAGE.finalizing,
      0.95,
      {
        last_successful_operation: "chained-index-enqueued",
        repository_id: repo.id,
        repository_slug: repo.slug,
        chained_job_id: chained.publicId,
        workspace_path: workspacePath!,
        processed_count: parsedCount,
        total_count: discovery.files.length,
        current_file: null,
      },
      base,
    );

    emit("finalizing", `Repository imported — indexing queued (${discovery.files.length} files)`, {
      filesDiscovered: discovery.files.length,
      filesParsed: parsedCount,
    });
    logInfo("ingestion: import completed", {
      jobId: publicId,
      repository: repo.slug,
      files: discovery.files.length,
      clonedSha: headSha.stdout.trim().slice(0, 12),
    });
  } catch (error) {
    /* ---------------- honest failure handling (spec §8) ---------------- */
    if (kind === "github" || kind === "git") vaultDelete(publicId);
    if (freshWorkspace && workspacePath) await removeWorkspace(workspacePath);
    if (repositoryRowId) {
      await db.repository
        .update({ where: { id: repositoryRowId }, data: { status: "unavailable" } })
        .catch(() => undefined);
    }

    if (error instanceof ImportCancelledError) {
      // External cancel observed (git child already SIGKILLed). The queue
      // leaves the CANCELLED row untouched — return, don't overwrite.
      logInfo("ingestion: import cancelled", { jobId: publicId });
      return;
    }

    if (error instanceof IngestionError) {
      logError("ingestion: import failed", { jobId: publicId, code: error.code, error: error.message });
      throw error; // message is pre-redacted + single-line
    }

    if (error instanceof ApiError) {
      // Validation re-check inside the job — same honest message, job failure.
      throw new IngestionError("MALFORMED_REPOSITORY", redactSecret(error.message, secrets));
    }

    const raw = sanitizeGitOutput(
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      secrets[0],
    );
    logError("ingestion: import failed (unexpected)", { jobId: publicId, error: raw });
    throw new IngestionError("MALFORMED_REPOSITORY", raw || "import failed unexpectedly.");
  }
};

/**
 * Resolve a ref on an EXISTING (incremental) workspace: commit → detached
 * checkout; branch → checkout -B from origin; else try tag (detached). All
 * failures are sanitized CHECKOUT_FAILED errors (spec §8).
 */
async function resolveRefAndCheckout(
  workspacePath: string,
  ref: string | undefined,
  checkCancel: () => Promise<boolean>,
  allowFile: boolean,
  token: string | undefined,
): Promise<void> {
  try {
    if (!ref) {
      await runGit({
        args: ["reset", "--hard", "origin/HEAD"],
        cwd: workspacePath,
        checkCancel,
        allowFileProtocol: allowFile,
        secret: token,
      });
      return;
    }
    if (isCommitRef(ref)) {
      await runGit({
        args: ["checkout", "-f", "--detach", ref],
        cwd: workspacePath,
        checkCancel,
        allowFileProtocol: allowFile,
        secret: token,
      }).catch(() => {
        throw new IngestionError(
          "CHECKOUT_FAILED",
          `commit ${ref} is not reachable in this checkout's history (shallow fetch — delete the import or use a branch/tag).`,
        );
      });
      return;
    }
    try {
      await runGit({
        args: ["checkout", "-f", "-B", ref, `origin/${ref}`],
        cwd: workspacePath,
        checkCancel,
        allowFileProtocol: allowFile,
        secret: token,
      });
    } catch {
      await runGit({
        args: ["checkout", "-f", "--detach", ref],
        cwd: workspacePath,
        checkCancel,
        allowFileProtocol: allowFile,
        secret: token,
      });
    }
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    const reason = sanitizeGitOutput(error instanceof Error ? error.message : String(error), token);
    throw new IngestionError("CHECKOUT_FAILED", `ref could not be checked out: ${reason || "not found"}`);
  }
}

/** Allocate a unique slug; re-imports reuse the existing row's slug. */
async function allocateSlug(displayName: string, existingId: string | null): Promise<string> {
  const base = slugifyName(displayName);
  if (existingId) {
    const row = await db.repository.findUnique({ where: { id: existingId }, select: { slug: true } });
    if (row) return row.slug;
  }
  if (!(await db.repository.findUnique({ where: { slug: base }, select: { id: true } }))) {
    return base;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${randomUUID().slice(0, 6)}`;
    if (!(await db.repository.findUnique({ where: { slug: candidate }, select: { id: true } }))) {
      return candidate;
    }
  }
  return `${base}-${randomUUID().slice(0, 12)}`;
}
