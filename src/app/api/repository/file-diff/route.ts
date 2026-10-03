import { NextResponse, type NextRequest } from "next/server";

import { readWorkspaceFileDiff } from "@/lib/server/git-diff";
import { audit } from "@/server/security/audit";

/**
 * GET /api/repository/file-diff?path=… (Phase 6 §4)
 * REAL worktree diff (hunks) + real HEAD baseline text for one allowlisted
 * workspace path. Data comes exclusively from git — never fabricated; git
 * failures degrade to an honest 503.
 *
 * Audit: one fire-and-forget "repository.access" row with
 * { path, scope: "file-diff" } — the path only, never contents.
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
    const result = await readWorkspaceFileDiff(filePath);
    if (result.ok && result.diff) {
      void audit.repositoryAccess({
        targetType: "file",
        targetId: filePath,
        metadata: { path: filePath, scope: "file-diff" },
      });
      return NextResponse.json({ ok: true, diff: result.diff });
    }
    const status =
      result.code === "forbidden"
        ? 403
        : result.code === "not-found"
          ? 404
          : 503;
    return legacyError(result.code ?? "error", status, result.message);
  } catch (error) {
    console.error("[api/repository/file-diff] failed:", error);
    return NextResponse.json(
      { ok: false, error: "File diff service failed." },
      { status: 500 },
    );
  }
}
