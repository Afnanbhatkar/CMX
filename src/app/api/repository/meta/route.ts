import { NextResponse } from "next/server";

import { readWorkspaceMeta } from "@/lib/server/repository-fs";

/**
 * GET /api/repository/meta
 * Real workspace facts: project name, real git branch, honest indexing state.
 */
export async function GET() {
  try {
    const meta = await readWorkspaceMeta();
    return NextResponse.json({ ok: true, ...meta });
  } catch (error) {
    console.error("[api/repository/meta] failed:", error);
    return NextResponse.json(
      { ok: false, error: "Repository metadata unavailable." },
      { status: 500 },
    );
  }
}
