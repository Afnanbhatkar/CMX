import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { runHealthChecks } from "@/server/services/health-service";

/**
 * GET /api/health — real dependency health (Phase 3, spec §9).
 * Response is no-store (security headers from withApi) so probes always see
 * the current truth, never a cached "healthy".
 */
export const GET = withApi(async (_req, ctx) => {
  const report = await runHealthChecks();
  return jsonOk(
    {
      overall: report.overall,
      checks: report.checks,
      uptimeSeconds: process.uptime(),
    },
    { requestId: ctx.requestId },
  );
});
