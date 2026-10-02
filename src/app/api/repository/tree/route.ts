import { NextResponse } from "next/server";

import { buildWorkspaceTree } from "@/lib/server/repository-fs";

/**
 * GET /api/repository/tree
 * Real file tree of the allowlisted workspace roots (read-only).
 * Loading/errors stay honest — no fabricated entries.
 */
export async function GET() {
  try {
    const tree = await buildWorkspaceTree();
    return NextResponse.json({ ok: true, tree });
  } catch (error) {
    console.error("[api/repository/tree] failed:", error);
    return NextResponse.json(
      { ok: false, error: "Repository tree unavailable." },
      { status: 500 },
    );
  }
}
