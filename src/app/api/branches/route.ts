import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { listBranches } from "@/server/services/git-service";

/**
 * GET /api/branches — real local git branches (Phase 3, spec §4).
 * Derived from actual git commands (`for-each-ref` + `rev-parse` +
 * `symbolic-ref`); `note` states exactly how isDefault was derived. If git
 * fails, the answer is an honest SERVICE_UNAVAILABLE envelope — never
 * fabricated branch data.
 */
export const GET = withApi(async (_req, ctx) => {
  const result = await listBranches();
  return jsonOk(result, { requestId: ctx.requestId });
});
