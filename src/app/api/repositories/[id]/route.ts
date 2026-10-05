import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { findRepositoryByIdentifier } from "@/server/services/repository-service";

/**
 * GET /api/repositories/[id] — real registry lookup (Phase 3, spec §4).
 * Accepts the repository's id OR its public slug (its unique public
 * identifier — the schema has no separate publicId column). Missing entries
 * answer with the REPOSITORY_NOT_FOUND envelope (404).
 *
 * Next 16 async params: `{ params: Promise<{ id: string }> }` is forwarded
 * untouched by withApi and awaited here.
 */
type RouteCtx = { params: Promise<{ id: string }> };

export const GET = withApi<RouteCtx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const repository = await findRepositoryByIdentifier(id);
  return jsonOk({ repository }, { requestId: ctx.requestId });
});
