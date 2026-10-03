import { NextResponse } from "next/server";

import { buildWorkspaceTree } from "@/lib/server/repository-fs";
import { audit } from "@/server/security/audit";

/**
 * GET /api/repository/tree
 * Real file tree of the allowlisted workspace roots (read-only).
 * Loading/errors stay honest — no fabricated entries.
 *
 * Audit (V2.1 §D): one "repository.access" row per request with
 * { scope: "tree" } metadata (no file contents). Fire-and-forget so listing
 * latency is unaffected (recordAudit never throws).
 */
export async function GET() {
  try {
    const tree = await buildWorkspaceTree();
    void audit.repositoryAccess({ targetType: "repository", metadata: { scope: "tree" } });
    return NextResponse.json({ ok: true, tree });
  } catch (error) {
    console.error("[api/repository/tree] failed:", error);
    return NextResponse.json(
      { ok: false, error: "Repository tree unavailable." },
      { status: 500 },
    );
  }
}
