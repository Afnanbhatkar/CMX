import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { searchQuerySchema } from "@/server/schemas/api";
import { buildWorkspaceTree } from "@/lib/server/repository-fs";
import { searchFileNames } from "@/server/services/file-service";

/**
 * GET /api/search?q=&limit= — honest filename search over the REAL workspace
 * tree (Phase 3, spec §4). Same semantics as the workspace search panel:
 * case-insensitive substring match on paths, capped results, no ranking.
 * `scope: "filenames"` + the note state exactly what this is — hybrid
 * semantic search is [PLANNED] and is not pretended here.
 */
export const GET = withApi(async (req, ctx) => {
  const url = new URL(req.url);
  const { q, limit } = searchQuerySchema.parse(Object.fromEntries(url.searchParams));

  const tree = await buildWorkspaceTree();
  const matches = searchFileNames(tree, q, limit);

  return jsonOk(
    {
      query: q,
      matches,
      scope: "filenames",
      note: "hybrid semantic search is [PLANNED]",
    },
    { requestId: ctx.requestId },
  );
});
