import { NextResponse } from "next/server";

import { readWorkspaceGitStatus } from "@/lib/server/git-status";
import { audit } from "@/server/security/audit";

/**
 * GET /api/repository/status (Phase 5)
 * REAL working-tree status of the canonical workspace: repo-relative path →
 * TreeGitStatus, plus branch + HEAD sha. The service never throws and the
 * route stays honest: a git failure is a 503 with the sanitized reason —
 * NEVER an empty map served as success.
 *
 * Audit (V2.1 §D): one fire-and-forget "repository.access" row with
 * { scope: "status", entries } — the COUNT only. Individual paths are NEVER
 * recorded (privacy rule: status covers the whole worktree).
 */
export async function GET() {
  try {
    const result = await readWorkspaceGitStatus();
    if (result.ok) {
      const entries = Object.keys(result.status).length;
      void audit.repositoryAccess({
        targetType: "repository",
        metadata: { scope: "status", entries },
      });
      return NextResponse.json({
        ok: true,
        status: result.status,
        branch: result.branch,
        headSha: result.headSha,
      });
    }
    // Honest failure: sanitized single-line reason from the service.
    return NextResponse.json(
      { ok: false, error: result.reason || "Git status is unavailable." },
      { status: 503 },
    );
  } catch (error) {
    // readWorkspaceGitStatus never throws — this is a truly unexpected fault.
    console.error("[api/repository/status] failed:", error);
    return NextResponse.json(
      { ok: false, error: "Git status service failed." },
      { status: 500 },
    );
  }
}
