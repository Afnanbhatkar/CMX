import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { buildWorkspaceSubtree, buildWorkspaceTree, resolveAllowedPath } from "@/lib/server/repository-fs";
import { audit } from "@/server/security/audit";

/**
 * GET /api/repository/tree            — whole tree of the allowlisted roots.
 * GET /api/repository/tree?path=dir   — children of ONE allowlisted directory
 *                                       (Phase 5 lazy loading for `truncated`
 *                                       dirs; same depth/entry caps + sort).
 *
 * Real, read-only listings; loading/errors stay honest — no fabricated
 * entries. The subtree variant rejects traversal/outside-allowlist paths
 * (403) and non-directory paths (404) without leaking filesystem detail.
 *
 * Audit (V2.1 §D): one fire-and-forget "repository.access" row per request —
 * metadata { scope: "tree" } or { scope: "tree-subtree", path }. Metadata
 * only: NEVER file contents.
 */
export async function GET(request: NextRequest) {
  const rawPath = request.nextUrl.searchParams.get("path");

  try {
    // No path param → legacy whole-tree behavior (consumers depend on it).
    if (rawPath === null || rawPath.trim().length === 0) {
      const tree = await buildWorkspaceTree();
      void audit.repositoryAccess({ targetType: "repository", metadata: { scope: "tree" } });
      return NextResponse.json({ ok: true, tree });
    }

    // Optional ?path= (≤512 chars) — zod-validated before any filesystem work.
    const parsed = z.string().max(512).safeParse(rawPath);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid 'path' query parameter." },
        { status: 400 },
      );
    }

    const check = resolveAllowedPath(parsed.data);
    if (!check.ok) {
      return NextResponse.json(
        { ok: false, error: "Repository path unavailable (forbidden)." },
        { status: 403 },
      );
    }

    const subtree = await buildWorkspaceSubtree(parsed.data);
    if (subtree === null) {
      // Allowlisted but not an existing directory under an allowed root.
      return NextResponse.json(
        { ok: false, error: "Repository path unavailable (not-found)." },
        { status: 404 },
      );
    }

    void audit.repositoryAccess({
      targetType: "repository",
      metadata: { scope: "tree-subtree", path: check.relative },
    });
    return NextResponse.json({ ok: true, tree: subtree });
  } catch (error) {
    console.error("[api/repository/tree] failed:", error);
    return NextResponse.json(
      { ok: false, error: "Repository tree unavailable." },
      { status: 500 },
    );
  }
}
