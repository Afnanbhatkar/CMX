/**
 * GET /api/orchestrator/runs — recent orchestrator runs (observability §8):
 * status, timing and agent-span count per run. Metadata only.
 */

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { listRecentRuns } from "@/server/orchestrator/engine";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const runs = await listRecentRuns(20);
  return jsonOk({ runs });
});
