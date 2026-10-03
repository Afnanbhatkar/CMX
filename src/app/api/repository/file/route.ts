import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isTextFile, readWorkspaceFile, resolveAllowedPath } from "@/lib/server/repository-fs";
import { readFileProvenance } from "@/lib/server/file-provenance";
import { audit } from "@/server/security/audit";

/**
 * GET /api/repository/file?path=…&variant=full|meta|preview|download
 *
 * variant=full (default) — EXACT legacy behavior (text-only read, strict
 *   allowlist, 400/403/404/413/415 legacy envelope) PLUS an additive
 *   top-level `meta` (FileProvenanceMeta) when provenance resolves; omitted
 *   when it fails — never fabricated.
 * variant=meta — provenance only, no content read; works for binaries too.
 * variant=preview — base64 image data URL (≤2MB, image extensions only).
 * variant=download — raw bytes (≤10MB) with provenance Content-Type.
 *
 * Audit (V2.1 §D): successful reads append one fire-and-forget
 * "repository.access" row. Metadata carries the path + scope — NEVER file
 * content (previews/downloads stream bytes, never audit them).
 */

const fileQuerySchema = z.object({
  variant: z.enum(["full", "meta", "preview", "download"]).default("full"),
});

/** Image extensions eligible for variant=preview (rendered via <img> only). */
const PREVIEW_IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

const PREVIEW_MAX_BYTES = 2_097_152; // 2 MB
const DOWNLOAD_MAX_BYTES = 10_485_760; // 10 MB

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

/** Legacy failure envelope — byte-identical shape to the pre-variant route. */
function legacyError(code: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: `File unavailable (${code}).` }, { status });
}

/* ------------------------------------------------------------------ */
/* variant=full — legacy behavior + additive provenance meta           */
/* ------------------------------------------------------------------ */

async function readFullVariant(filePath: string): Promise<NextResponse> {
  const result = await readWorkspaceFile(filePath);
  if (result.ok) {
    // Additive Phase 5 metadata: omitted entirely when provenance fails.
    const provenance = await readFileProvenance(filePath);
    const body: { ok: true; file: typeof result.file; meta?: unknown } = {
      ok: true,
      file: result.file,
    };
    if (provenance.ok) body.meta = provenance.provenance;

    void audit.repositoryAccess({
      targetType: "file",
      targetId: filePath,
      metadata: { path: filePath },
    });
    return NextResponse.json(body);
  }
  const status =
    result.code === "not-found"
      ? 404
      : result.code === "too-large"
        ? 413
        : result.code === "binary"
          ? 415
          : 403;
  return legacyError(result.code, status);
}

/* ------------------------------------------------------------------ */
/* variant=meta — provenance for ANY allowlisted file (binaries too)   */
/* ------------------------------------------------------------------ */

async function readMetaVariant(filePath: string): Promise<NextResponse> {
  // readFileProvenance validates the path first: resolve-fail → forbidden
  // (403), stat-fail / not a regular file → not-found (404) / forbidden (403).
  const provenance = await readFileProvenance(filePath);
  if (provenance.ok) {
    void audit.repositoryAccess({
      targetType: "file",
      targetId: filePath,
      metadata: { path: filePath, scope: "meta" },
    });
    return NextResponse.json({ ok: true, meta: provenance.provenance });
  }
  return legacyError(
    provenance.code,
    provenance.code === "not-found" ? 404 : 403,
  );
}

/* ------------------------------------------------------------------ */
/* variant=preview — base64 image data URL (server-side, ≤2MB)         */
/* ------------------------------------------------------------------ */

async function readPreviewVariant(filePath: string): Promise<NextResponse> {
  const check = resolveAllowedPath(filePath);
  if (!check.ok) return legacyError("forbidden", 403);

  let stat;
  try {
    stat = await fs.stat(check.absolute);
  } catch {
    return legacyError("not-found", 404);
  }
  if (!stat.isFile()) return legacyError("forbidden", 403);

  const mime = PREVIEW_IMAGE_MIME_BY_EXT[extOf(path.basename(check.relative))];
  if (!mime) {
    // Text files have a first-class view; other binaries are not previewable.
    return NextResponse.json(
      {
        ok: false,
        error: isTextFile(path.basename(check.relative))
          ? "Use the standard file view for text files"
          : "Preview unavailable for this file type",
      },
      { status: 415 },
    );
  }
  if (stat.size > PREVIEW_MAX_BYTES) return legacyError("too-large", 413);

  let buf: Buffer;
  try {
    buf = await fs.readFile(check.absolute);
  } catch {
    return legacyError("not-found", 404);
  }

  void audit.repositoryAccess({
    targetType: "file",
    targetId: filePath,
    metadata: { path: filePath, scope: "preview" },
  });
  return NextResponse.json({
    ok: true,
    preview: {
      kind: "image",
      mimeType: mime,
      dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
    },
  });
}

/* ------------------------------------------------------------------ */
/* variant=download — raw bytes (≤10MB), provenance Content-Type       */
/* ------------------------------------------------------------------ */

async function readDownloadVariant(filePath: string): Promise<Response> {
  const check = resolveAllowedPath(filePath);
  if (!check.ok) return legacyError("forbidden", 403);

  let stat;
  try {
    stat = await fs.stat(check.absolute);
  } catch {
    return legacyError("not-found", 404);
  }
  if (!stat.isFile()) return legacyError("forbidden", 403);
  if (stat.size > DOWNLOAD_MAX_BYTES) return legacyError("too-large", 413);

  let buf: Buffer;
  try {
    buf = await fs.readFile(check.absolute);
  } catch {
    return legacyError("not-found", 404);
  }

  // Content-Type comes from the provenance MIME map; unknown → honest
  // generic octet-stream. Provenance never reads full content (8KB sniff).
  const provenance = await readFileProvenance(filePath);
  const mimeType =
    provenance.ok && provenance.provenance.mimeType
      ? provenance.provenance.mimeType
      : "application/octet-stream";

  const filename = path.basename(check.relative).replace(/[\r\n"]/g, "_");

  void audit.repositoryAccess({
    targetType: "file",
    targetId: filePath,
    metadata: { path: filePath, scope: "download" },
  });
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(buf.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath || filePath.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Missing 'path' query parameter." },
      { status: 400 },
    );
  }

  // zod validation failure → 400 (unknown variant, etc.). Path shape itself
  // stays enforced by resolveAllowedPath (403) exactly as before.
  const parsed = fileQuerySchema.safeParse({
    variant: request.nextUrl.searchParams.get("variant") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid 'variant' query parameter." },
      { status: 400 },
    );
  }

  try {
    switch (parsed.data.variant) {
      case "meta":
        return await readMetaVariant(filePath);
      case "preview":
        return await readPreviewVariant(filePath);
      case "download":
        return await readDownloadVariant(filePath);
      case "full":
      default:
        return await readFullVariant(filePath);
    }
  } catch (error) {
    console.error("[api/repository/file] failed:", error);
    return NextResponse.json(
      { ok: false, error: "File service failed." },
      { status: 500 },
    );
  }
}
