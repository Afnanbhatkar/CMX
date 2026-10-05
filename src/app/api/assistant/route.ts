import { withApi } from "@/server/api/with-api";
import { ApiError, jsonOk } from "@/server/api/envelope";
import { assistantRequestSchema } from "@/server/schemas/api";
import {
  AssistantError,
  runAssistantTurn,
  type AssistantMessage,
} from "@/server/services/assistant-service";

/**
 * POST /api/assistant — versioned assistant surface (Phase 3, spec §4).
 *
 * Accepts either:
 * - single-turn form: { message, context? }, or
 * - history form: { messages, context? } (same payload the legacy
 *   /api/ai/chat serves today).
 *
 * The completion itself lives in assistant-service (shared with the legacy
 * route). Every successful turn also records a privacy-safe Activity row
 * (inside the service; DB logging can never break the response). Failures map
 * honestly: empty/unavailable completions → 502 SERVICE_UNAVAILABLE envelope,
 * invalid input → 422 VALIDATION_ERROR with safe zod details.
 */
export const POST = withApi(
  async (req, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApiError("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const parsed = assistantRequestSchema.parse(body);
    const turnMessages: AssistantMessage[] =
      parsed.message !== undefined
        ? [{ role: "user", content: parsed.message }]
        : (parsed.messages ?? []);

    try {
      const { content } = await runAssistantTurn({
        messages: turnMessages,
        context: parsed.context,
      });
      return jsonOk({ content }, { requestId: ctx.requestId });
    } catch (error) {
      if (error instanceof AssistantError) {
        throw new ApiError("SERVICE_UNAVAILABLE", error.message, 502);
      }
      throw error;
    }
  },
  { allowBody: true },
);
