import { NextResponse, type NextRequest } from "next/server";

import { readWorkspaceFileBlame } from "@/lib/server/git-blame";
import { audit } from "@/server/security/audit";

/**
 * GET /api/repository/file-blame?path=… (Phase 6 §4)
 * REAL `git blame --line-porcelain` for one allowlisted workspace path,
 * grouped into consecutive ranges sharing a commit. Data comes exclusively
 * from git — never fabricated; failures degrade to honest 4xx/5xx envelopes.
 *
 * Audit: one fire-and-forget "repository.access" row with
 * { path, scope: "file-blame" } — the path only, never contents.
 */

/** Legacy failure envelope — same shape as the file read route. */
function legacyError(code: string, status: number, message?: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: message || `File unavailable (${code}).` },
    { status },
  );
}

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath || filePath.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Missing 'path' query parameter." },
      { status: 400 },
    );
  }
  if (filePath.length > 512) {
    return NextResponse.json(
      { ok: false, error: "Invalid 'path' query parameter." },
      { status: 400 },
    );
  }

  try {
    const result = await readWorkspaceFileBlame(filePath);
    if (result.ok && result.blame) {
      void audit.repositoryAccess({
        targetType: "file",
        targetId: filePath,
        metadata: { path: filePath, scope: "file-blame" },
      });
      return NextResponse.json({ ok: true, blame: result.blame });
    }
    const status =
      result.code === "forbidden"
        ? 403
        : result.code === "not-found"
          ? 404
          : result.code === "too-large"
            ? 413
            : 503;
    return legacyError(result.code ?? "error", status, result.message);
  } catch (error) {
    console.error("[api/repository/file-blame] failed:", error);
    return NextResponse.json(
      { ok: false, error: "File blame service failed." },
      { status: 500 },
    );
  }
}
