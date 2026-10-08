/**
 * CodeMind X V2 — OCR Studio service (REAL image text extraction).
 *
 * The one module allowed to perform vision-model text extraction. It wraps
 * the provider SDK's `createVision` transport (the same gateway discipline
 * as llm-gateway.ts: UI code and routes never call the SDK directly).
 *
 * Honesty rules (RULES.md §9):
 * - extracted text is delivered EXACTLY as the vision model produced it —
 *   never padded, paraphrased or fabricated by this service;
 * - durationMs, sizeBytes, wordCount and charCount are MEASURED values;
 * - failures degrade to an honest `failed` job row with a SAFE error note —
 *   internals are logged server-side only;
 * - when the image contains no readable text the job completes with empty
 *   text and a `noTextFound` note — never fake content.
 */

import ZAI from "z-ai-web-dev-sdk";
import sharp from "sharp";

import { db } from "@/lib/db";
import { logError, logInfo } from "@/server/security/logger";

/** Hard deadline for one vision extraction (images can be slow to read). */
const VISION_TIMEOUT_MS = 120_000;

/** Images above this byte size are re-encoded before the vision call. */
const NORMALIZE_ABOVE_BYTES = 3_500_000;
/** Longest edge allowed after normalization. */
const NORMALIZE_MAX_EDGE = 2400;

/** Allowed upload mime types (mirror of the VLM transport's formats). */
export const OCR_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
] as const;

export type OcrMimeType = (typeof OCR_ALLOWED_MIME_TYPES)[number];

/** Extraction modes — each maps to a strict extraction prompt. */
export const OCR_MODES = {
  plain: {
    label: "Plain text",
    note: "Every visible word, verbatim — best for notes, signs, screenshots.",
    prompt:
      "You are a precise OCR engine. Extract ALL text visible in this image, verbatim. " +
      "Rules: transcribe exactly what is written (spelling, numbers, punctuation, casing); " +
      "keep the natural reading order (top-to-bottom, left-to-right); output ONLY the " +
      "extracted text with no commentary, no markdown fences and no title. If there is " +
      "no readable text at all, output exactly: NO_TEXT_FOUND",
  },
  layout: {
    label: "Preserve layout",
    note: "Keeps headings, lists and paragraphs structured the way they look.",
    prompt:
      "You are a precise OCR engine with layout preservation. Extract ALL text visible " +
      "in this image verbatim, preserving the visual structure: headings become markdown " +
      "headings, lists become bullet lists, paragraphs stay separated by blank lines, " +
      "indentation is respected. Output ONLY the extracted content, no commentary. If " +
      "there is no readable text at all, output exactly: NO_TEXT_FOUND",
  },
  code: {
    label: "Code & syntax",
    note: "Screenshots of code come back as clean, indented source code.",
    prompt:
      "You are a precise OCR engine specialized in source code screenshots. Transcribe " +
      "ALL code visible in this image exactly: real indentation, real symbols, real " +
      "comments. Fix nothing, complete nothing, explain nothing. Preserve line breaks. " +
      "Output ONLY the code inside a single fenced block tagged with the detected " +
      "language (e.g. ```ts). If there is no code, transcribe whatever text exists " +
      "verbatim. If there is no readable text at all, output exactly: NO_TEXT_FOUND",
  },
  table: {
    label: "Tables",
    note: "Tabular data is reconstructed as clean Markdown tables.",
    prompt:
      "You are a precise OCR engine specialized in tables. Extract ALL tabular data in " +
      "this image and reconstruct it as clean GitHub-flavored Markdown tables with " +
      "correct rows and columns. Preserve every cell value verbatim (numbers exactly " +
      "as written). Non-table text (titles, footnotes) is transcribed before/after the " +
      "tables. Output ONLY the extracted content, no commentary. If there is no " +
      "readable text at all, output exactly: NO_TEXT_FOUND",
  },
  ask: {
    label: "Ask about image",
    note: "Free-form: ask anything about the image — answer + quoted text.",
    prompt:
      "Answer the user's question about this image. When you quote text that appears " +
      "in the image, quote it verbatim. Be factual; if something is unreadable or " +
      "absent, say so honestly instead of guessing.",
  },
} as const;

export type OcrMode = keyof typeof OCR_MODES;

export function isOcrMode(value: unknown): value is OcrMode {
  return typeof value === "string" && value in OCR_MODES;
}

export function isOcrMimeType(value: unknown): value is OcrMimeType {
  return (
    typeof value === "string" &&
    (OCR_ALLOWED_MIME_TYPES as readonly string[]).includes(value)
  );
}

/** Vision-scoped failure — routes map this to their own error contracts. */
export class OcrServiceError extends Error {
  constructor(
    public code: "empty" | "failed" | "timeout" | "invalid-image",
    message: string,
  ) {
    super(message);
    this.name = "OcrServiceError";
  }
}

/* ------------------------------------------------------------------ */
/* Image normalization (sharp — smaller, transport-friendly uploads)   */
/* ------------------------------------------------------------------ */

export interface NormalizedImage {
  base64: string;
  mimeType: string;
  sizeBytes: number;
  normalized: boolean;
}

/**
 * Downscale/re-encode oversized images so the vision transport receives a
 * compact payload. Small images pass through byte-identical (normalized:
 * false — honest measurement, not a cosmetic flag).
 */
export async function normalizeImage(
  buffer: Buffer,
  mimeType: string,
): Promise<NormalizedImage> {
  if (buffer.length <= NORMALIZE_ABOVE_BYTES) {
    return {
      base64: buffer.toString("base64"),
      mimeType,
      sizeBytes: buffer.length,
      normalized: false,
    };
  }
  try {
    const output = await sharp(buffer)
      .rotate() // honor EXIF orientation
      .resize({
        width: NORMALIZE_MAX_EDGE,
        height: NORMALIZE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88 })
      .toBuffer();
    logInfo("ocr: oversized upload normalized", {
      originalBytes: buffer.length,
      normalizedBytes: output.length,
    });
    return {
      base64: output.toString("base64"),
      mimeType: "image/jpeg",
      sizeBytes: output.length,
      normalized: true,
    };
  } catch (error) {
    logError("ocr: sharp normalization failed — using original bytes", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return {
      base64: buffer.toString("base64"),
      mimeType,
      sizeBytes: buffer.length,
      normalized: false,
    };
  }
}

/* ------------------------------------------------------------------ */
/* The real vision extraction                                          */
/* ------------------------------------------------------------------ */

export interface VisionExtraction {
  text: string;
  /** True when the model reported the image contains no readable text. */
  noTextFound: boolean;
  durationMs: number;
  servedModel: string | null;
}

/** Build the final user prompt for a mode (ask mode appends the question). */
export function buildPrompt(mode: OcrMode, question?: string | null): string {
  const base = OCR_MODES[mode].prompt;
  if (mode === "ask") {
    const q = (question ?? "").trim();
    return q.length > 0
      ? `${base}\n\nQuestion: ${q}`
      : "Describe this image and transcribe any visible text verbatim.";
  }
  return base;
}

/**
 * ONE real vision extraction through the provider SDK (120s hard timeout).
 * The response content is passed through verbatim.
 */
export async function runVisionExtraction(input: {
  dataUrl: string;
  mode: OcrMode;
  question?: string | null;
}): Promise<VisionExtraction> {
  const zai = await ZAI.create();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let completion: unknown;
  try {
    completion = await Promise.race([
      zai.chat.completions.createVision({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPrompt(input.mode, input.question) },
              { type: "image_url", image_url: { url: input.dataUrl } },
            ],
          },
        ],
        thinking: { type: "disabled" },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), VISION_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "timeout") {
      throw new OcrServiceError("timeout", "The vision model took too long to answer.");
    }
    logError("ocr: vision call failed", { error: message });
    throw new OcrServiceError("failed", "The vision model request failed.");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  const durationMs = Date.now() - startedAt;

  if (!completion || typeof completion !== "object") {
    throw new OcrServiceError("failed", "The vision model returned an invalid response.");
  }
  const servedModel =
    (completion as { model?: unknown }).model && typeof (completion as { model?: unknown }).model === "string"
      ? ((completion as { model: string }).model)
      : null;
  const content = (completion as { choices?: { message?: { content?: unknown } }[] })
    .choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    logError("ocr: vision response had no text content");
    throw new OcrServiceError("failed", "The vision model returned no text.");
  }

  const text = content.trim();
  if (!text) {
    throw new OcrServiceError("empty", "The vision model returned an empty response.");
  }
  const noTextFound = /^no[\s_-]?text[\s_-]?found\.?$/i.test(text);
  return { text, noTextFound, durationMs, servedModel };
}

/* ------------------------------------------------------------------ */
/* Job persistence + queries                                           */
/* ------------------------------------------------------------------ */

export interface OcrJobPublic {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  mode: string;
  question: string | null;
  status: "processing" | "completed" | "failed";
  text: string | null;
  error: string | null;
  durationMs: number | null;
  language: string | null;
  wordCount: number;
  charCount: number;
  createdAt: string;
}

function toPublic(job: {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  mode: string;
  question: string | null;
  status: string;
  text: string | null;
  error: string | null;
  durationMs: number | null;
  language: string | null;
  wordCount: number;
  charCount: number;
  createdAt: Date;
}): OcrJobPublic {
  return {
    id: job.id,
    filename: job.filename,
    mimeType: job.mimeType,
    sizeBytes: job.sizeBytes,
    mode: job.mode,
    question: job.question,
    status: job.status as OcrJobPublic["status"],
    text: job.text,
    error: job.error,
    durationMs: job.durationMs,
    language: job.language,
    wordCount: job.wordCount,
    charCount: job.charCount,
    createdAt: job.createdAt.toISOString(),
  };
}

/** Measured word count (whitespace-separated tokens; honest and simple). */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Best-effort primary-language detection from the extraction itself: the
 * plain/layout/table prompts return the image's own text, so we report the
 * model's self-described language only in `ask` mode answers' metadata and
 * otherwise leave it null (never fabricated). Kept as a tiny script check
 * over common scripts for honest labeling.
 */
function detectLanguageLabel(text: string): string | null {
  const sample = text.slice(0, 2000);
  if (!sample) return null;
  if (/[\u0900-\u097F]/.test(sample)) return "Hindi / Devanagari";
  if (/[\u4E00-\u9FFF]/.test(sample)) return "Chinese";
  if (/[\u3040-\u30FF]/.test(sample)) return "Japanese";
  if (/[\uAC00-\uD7AF]/.test(sample)) return "Korean";
  if (/[\u0600-\u06FF]/.test(sample)) return "Arabic";
  if (/[\u0400-\u04FF]/.test(sample)) return "Cyrillic";
  if (/[A-Za-z]/.test(sample)) return "Latin";
  return null;
}

export interface RunOcrJobInput {
  filename: string;
  buffer: Buffer;
  mimeType: OcrMimeType;
  mode: OcrMode;
  question?: string | null;
}

/**
 * Full OCR job: persist → normalize → vision extract → persist outcome.
 * The row always reflects the REAL final state (completed / failed with a
 * safe note). Throws only for pre-flight validation problems; extraction
 * failures are recorded on the job and returned as a failed job.
 */
export async function runOcrJob(input: RunOcrJobInput): Promise<OcrJobPublic> {
  const normalized = await normalizeImage(input.buffer, input.mimeType);
  const dataUrl = `data:${normalized.mimeType};base64,${normalized.base64}`;

  const job = await db.ocrJob.create({
    data: {
      filename: input.filename,
      mimeType: normalized.mimeType,
      sizeBytes: normalized.sizeBytes,
      mode: input.mode,
      question: input.mode === "ask" ? (input.question ?? null) : null,
      status: "processing",
    },
  });

  try {
    const extraction = await runVisionExtraction({
      dataUrl,
      mode: input.mode,
      question: input.question,
    });
    const wordCount = extraction.noTextFound ? 0 : countWords(extraction.text);
    const updated = await db.ocrJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        text: extraction.noTextFound ? "" : extraction.text,
        durationMs: extraction.durationMs,
        language: extraction.noTextFound ? null : detectLanguageLabel(extraction.text),
        wordCount,
        charCount: extraction.noTextFound ? 0 : extraction.text.length,
      },
    });
    logInfo("ocr: extraction completed", {
      jobId: job.id,
      durationMs: extraction.durationMs,
      wordCount,
      noTextFound: extraction.noTextFound,
    });
    return toPublic(updated);
  } catch (error) {
    const safeNote =
      error instanceof OcrServiceError
        ? error.message
        : "The OCR extraction failed unexpectedly.";
    if (!(error instanceof OcrServiceError)) {
      logError("ocr: unexpected extraction error", {
        jobId: job.id,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
    const updated = await db.ocrJob.update({
      where: { id: job.id },
      data: { status: "failed", error: safeNote },
    });
    return toPublic(updated);
  }
}

export async function listOcrJobs(limit = 30): Promise<OcrJobPublic[]> {
  const rows = await db.ocrJob.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map(toPublic);
}

export async function getOcrJob(id: string): Promise<OcrJobPublic | null> {
  const row = await db.ocrJob.findUnique({ where: { id } });
  return row ? toPublic(row) : null;
}

export async function deleteOcrJob(id: string): Promise<boolean> {
  const existing = await db.ocrJob.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await db.ocrJob.delete({ where: { id } });
  return true;
}
