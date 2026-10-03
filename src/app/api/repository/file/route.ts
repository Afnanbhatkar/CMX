import { NextResponse, type NextRequest } from "next/server";

import { readWorkspaceFile } from "@/lib/server/repository-fs";
import { audit } from "@/server/security/audit";

/**
 * GET /api/repository/file?path=…
 * Real, read-only file content with strict allowlisting:
 * 400 invalid path · 403 outside allowed roots · 404 missing · 413 too large · 415 binary.
 *
 * Audit (V2.1 §D): successful reads append one "repository.access" row with
 * { path } metadata — the path only, NEVER file content. Fire-and-forget so
 * read latency is unaffected (recordAudit never throws).
 */
export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath || filePath.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Missing 'path' query parameter." },
      { status: 400 },
    );
  }

  try {
    const result = await readWorkspaceFile(filePath);
    if (result.ok) {
      void audit.repositoryAccess({
        targetType: "file",
        targetId: filePath,
        metadata: { path: filePath },
      });
      return NextResponse.json({ ok: true, file: result.file });
    }
    const status =
      result.code === "not-found"
        ? 404
        : result.code === "too-large"
          ? 413
          : result.code === "binary"
            ? 415
            : 403;
    return NextResponse.json(
      { ok: false, error: `File unavailable (${result.code}).` },
      { status },
    );
  } catch (error) {
    console.error("[api/repository/file] failed:", error);
    return NextResponse.json(
      { ok: false, error: "File service failed." },
      { status: 500 },
    );
  }
}
