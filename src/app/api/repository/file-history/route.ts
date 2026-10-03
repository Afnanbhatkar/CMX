import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readFileHistory } from "@/lib/server/file-provenance";
import { audit } from "@/server/security/audit";

/**
 * GET /api/repository/file-history?path=…&limit=1..20 (Phase 5)
 * REAL `git log --follow` for one allowlisted workspace path. Commits are
 * exactly what git reports (sha/author/ISO date/subject) — never fabricated;
 * a git failure degrades to an honest 503, never to invented rows.
 *
 * Audit (V2.1 §D): one fire-and-forget "repository.access" row with
 * { path, scope: "file-history" } — the path only, consistent with the file
 * read route. NEVER commit contents.
 */
const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

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

  const parsed = historyQuerySchema.safeParse({
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid 'limit' query parameter (expected 1..20)." },
      { status: 400 },
    );
  }

  try {
    const result = await readFileHistory(filePath, parsed.data.limit);
    if (result.ok) {
      void audit.repositoryAccess({
        targetType: "file",
        targetId: filePath,
        metadata: { path: filePath, scope: "file-history" },
      });
      return NextResponse.json({ ok: true, commits: result.commits });
    }
    // Service failure codes → honest legacy envelopes (403/404/503).
    const status =
      result.code === "forbidden" ? 403 : result.code === "not-found" ? 404 : 503;
    return legacyError(result.code, status, result.message);
  } catch (error) {
    // readFileHistory never throws — this is a truly unexpected fault.
    console.error("[api/repository/file-history] failed:", error);
    return NextResponse.json(
      { ok: false, error: "File history service failed." },
      { status: 500 },
    );
  }
}
