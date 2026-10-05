import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { getGitOverview } from "@/server/services/git-service";

/**
 * GET /api/git — real git facts for the workspace (Phase 3, spec §4):
 * current branch + last 20 commits (sha, author, ISO date, subject) via
 * `git log --max-count=20 --pretty=format:%H%x1f%an%x1f%aI%x1f%s`.
 * Read-only; nothing is persisted by this handler. If git fails the answer
 * is an honest SERVICE_UNAVAILABLE envelope.
 */
export const GET = withApi(async (_req, ctx) => {
  const overview = await getGitOverview();
  return jsonOk(
    { branch: overview.branch, commits: overview.commits },
    { requestId: ctx.requestId },
  );
});
