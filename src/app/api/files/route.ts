import { withApi } from "@/server/api/with-api";
import { ApiError, jsonOk } from "@/server/api/envelope";
import { pathQuerySchema } from "@/server/schemas/api";
import { readFileForApi } from "@/server/services/file-service";

/**
 * GET /api/files?path=… — real workspace file read (Phase 3, spec §4).
 * Identical safety semantics to /api/repository/file (shared file-service):
 * allowlisted roots only, traversal/dotfile rejection, binary + size caps.
 * Invalid/missing ?path= → 422 VALIDATION_ERROR envelope (zod).
 */
export const GET = withApi(async (req, ctx) => {
  const url = new URL(req.url);
  const { path } = pathQuerySchema.parse(Object.fromEntries(url.searchParams));

  const result = await readFileForApi(path);
  if (!result.ok) {
    throw new ApiError(result.code, result.message, result.status);
  }
  return jsonOk({ file: result.file }, { requestId: ctx.requestId });
});
