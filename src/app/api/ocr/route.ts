import { z } from "zod";

import { withApi } from "@/server/api/with-api";
import { ApiError, jsonOk } from "@/server/api/envelope";
import {
  isOcrMimeType,
  isOcrMode,
  listOcrJobs,
  runOcrJob,
  OCR_MODES,
} from "@/server/services/ocr-service";

/**
 * CodeMind X V2 — OCR Studio API (REAL vision extraction).
 *
 * POST /api/ocr — multipart/form-data:
 *   file:      the image (png/jpeg/webp/gif/bmp, ≤ 12 MB upload cap via
 *              withApi maxBodyBytes; the absolute 64 MB ceiling holds),
 *   mode:      "plain" | "layout" | "code" | "table" | "ask" (default plain),
 *   question?: required when mode === "ask" (≤ 500 chars).
 *
 * → 200 { data: OcrJobPublic }. The extraction runs synchronously through
 * the vision transport; the job row in the database always reflects the
 * REAL outcome (completed text / failed with a safe note). No text is ever
 * fabricated: an image without readable text completes with empty text.
 *
 * GET /api/ocr — recent job history (newest first, ≤ 100).
 */

export const dynamic = "force-dynamic";

/** 12 MB upload cap for images (within SECURITY_CONFIG.absoluteMaxBodyBytes). */
const MAX_IMAGE_UPLOAD_BYTES = 12 * 1024 * 1024;

const fieldsSchema = z.object({
  mode: z.string().max(20).optional(),
  question: z.string().max(500).optional(),
});

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
      throw new ApiError("VALIDATION_ERROR", "A non-empty image 'file' is required.", 422);
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new ApiError(
        "PAYLOAD_TOO_LARGE",
        `Image exceeds the ${Math.round(MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024))} MB upload limit.`,
        413,
      );
    }
    if (!isOcrMimeType(file.type)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Unsupported image type. Allowed: PNG, JPEG, WebP, GIF, BMP.",
        422,
      );
    }

    const fields = fieldsSchema.parse({
      mode: form.get("mode") ?? undefined,
      question: form.get("question") ?? undefined,
    });
    const mode = fields.mode === undefined || fields.mode === "" ? "plain" : fields.mode;
    if (!isOcrMode(mode)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `Unknown mode "${fields.mode ?? ""}". Valid modes: ${Object.keys(OCR_MODES).join(", ")}.`,
        422,
      );
    }
    const question = (fields.question ?? "").trim();
    if (mode === "ask" && question.length === 0) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "mode \"ask\" requires a non-empty 'question' field.",
        422,
      );
    }

    // Sanitized display name: strip path components, cap length, keep honest
    // fallback for nameless uploads (e.g. pasted screenshots).
    const rawName = (file.name || "pasted-image").replace(/\\/g, "/");
    const filename = (rawName.split("/").pop() || "pasted-image").slice(0, 180);

    const buffer = Buffer.from(await file.arrayBuffer());
    const job = await runOcrJob({ filename, buffer, mimeType: file.type, mode, question });

    return jsonOk(job, { requestId: ctx.requestId });
  },
  { maxBodyBytes: MAX_IMAGE_UPLOAD_BYTES },
);

export const GET = withApi(async (_req, ctx) => {
  const jobs = await listOcrJobs(30);
  return jsonOk({ jobs }, { requestId: ctx.requestId });
});
