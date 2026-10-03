import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { withApi } from "@/server/api/with-api";
import { ApiError, jsonOk } from "@/server/api/envelope";
import { recoverInterruptedJobs } from "@/server/jobs/recovery";
import { enqueueJob } from "@/server/jobs/queue";
import { INGESTION_UPLOAD_STAGING } from "@/server/ingestion/config";
import { validatePatternList } from "@/server/ingestion/url-validation";

/**
 * CodeMind X V2 — ZIP upload import API (Phase 4, spec §1/§2/§6).
 *
 * POST /api/repositories/import/zip — multipart/form-data:
 *   file:            the .zip archive (≤ 32 MB upload cap via withApi
 *                    maxBodyBytes; the absolute 64 MB ceiling holds),
 *   name?:           display name (defaults to the file name),
 *   ignorePatterns?: JSON-encoded string[] (extra ignores),
 *   includePatterns?: JSON-encoded string[] (re-include; include-first wins).
 *
 * → 202 { data: { jobId } }. The route performs NO extraction: it verifies
 * the ZIP magic, stages the archive under .ingestion-workspaces/uploads/
 * (git-ignored), and enqueues a "repository.import" job (kind "zip") whose
 * extraction runs behind the hardened guards in zip-extract.ts (entry cap,
 * total/per-entry size caps, ratio suspicion, traversal rejection, disk
 * quota). The staged file is deleted by the job after extraction.
 */

void recoverInterruptedJobs();

export const dynamic = "force-dynamic";

/** 32 MB upload cap for archives (within SECURITY_CONFIG.absoluteMaxBodyBytes). */
const MAX_ZIP_UPLOAD_BYTES = 32 * 1024 * 1024;

const fieldsSchema = z.object({
  name: z.string().max(200).optional(),
  ignorePatterns: z.string().max(10_000).optional(),
  includePatterns: z.string().max(10_000).optional(),
});

function parsePatternField(raw: string | undefined, field: "ignorePatterns" | "includePatterns"): string[] | undefined {
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError("VALIDATION_ERROR", `${field} must be a JSON-encoded array of strings.`, 422);
  }
  return validatePatternList(parsed, field);
}

export const POST = withApi(
  async (req, ctx) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError("BAD_REQUEST", "Expected a multipart/form-data body.", 400);
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ApiError("VALIDATION_ERROR", "A non-empty 'file' (zip archive) is required.", 422);
    }
    if (file.size > MAX_ZIP_UPLOAD_BYTES) {
      throw new ApiError(
        "PAYLOAD_TOO_LARGE",
        `Archive exceeds the ${Math.round(MAX_ZIP_UPLOAD_BYTES / (1024 * 1024))} MB upload limit.`,
        413,
      );
    }

    const fields = fieldsSchema.parse({
      name: form.get("name") ?? undefined,
      ignorePatterns: form.get("ignorePatterns") ?? undefined,
      includePatterns: form.get("includePatterns") ?? undefined,
    });
    const ignorePatterns = parsePatternField(fields.ignorePatterns, "ignorePatterns");
    const includePatterns = parsePatternField(fields.includePatterns, "includePatterns");

    const bytes = Buffer.from(await file.arrayBuffer());
    // ZIP magic check before staging (extraction guards re-check everything).
    if (
      bytes.length < 4 ||
      bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04
    ) {
      throw new ApiError("VALIDATION_ERROR", "Uploaded file is not a ZIP archive.", 422);
    }

    await fs.mkdir(INGESTION_UPLOAD_STAGING, { recursive: true });
    const stagedPath = path.join(INGESTION_UPLOAD_STAGING, `${randomUUID()}.zip`);
    await fs.writeFile(stagedPath, bytes);
    bytes.fill(0);

    const row = await enqueueJob({
      type: "repository.import",
      input: {
        kind: "zip",
        zipPath: stagedPath,
        name: fields.name || file.name.replace(/\.zip$/i, "") || undefined,
        ignorePatterns,
        includePatterns,
        force: true, // archives have no stable identity — duplicates allowed by design
      },
    });

    return jsonOk(
      {
        jobId: row.publicId,
        note: "Archive staged; extraction + indexing run in the import job. Extraction guards: 50,000 entries, 512 MB total, 25 MB per entry, >200x ratio rejection, traversal/absolute entry names rejected.",
      },
      { status: 202, requestId: ctx.requestId },
    );
  },
  { allowBody: true, maxBodyBytes: MAX_ZIP_UPLOAD_BYTES },
);
