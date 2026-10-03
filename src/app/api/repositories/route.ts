import { withApi } from "@/server/api/with-api";
import { jsonError, jsonOk } from "@/server/api/envelope";
import { listRepositories } from "@/server/services/repository-service";

/**
 * GET /api/repositories — real registry list (Phase 3, spec §4).
 * SQLite `repositories` rows (take 50, newest first) merged with the live
 * workspace meta (real project name + real git branch). Zero rows is an
 * honest empty registry, not an error.
 *
 * POST /api/repositories — repository registration is [PLANNED]; the honest
 * answer is the standard NOT_IMPLEMENTED envelope.
 */
export const GET = withApi(async (_req, ctx) => {
  const { repositories, workspace } = await listRepositories();
  return jsonOk(
    { repositories, workspace, count: repositories.length },
    { requestId: ctx.requestId },
  );
});

export const POST = withApi(async (_req, ctx) =>
  jsonError(
    "NOT_IMPLEMENTED",
    "Repository endpoints arrive in a later phase — contract is prepared.",
    { status: 501, requestId: ctx.requestId },
  ),
);
