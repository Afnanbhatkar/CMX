import { GATEWAY_PROVIDER } from "@/server/llm/llm-gateway";
import { securityHeaders } from "@/server/security/config";

/**
 * GET /api/assistant/capabilities — Phase 8.5 §9 capability registry surface.
 *
 * Everything here is MEASURED truth about THIS build's transport, never a
 * claimed capability:
 * - imageUnderstanding: the gateway's `GatewayMessage.content` is a string —
 *   the transport has NO image part support today, so image flows are
 *   capability-gated OFF and the UI says so honestly.
 * - diagramRendering: mermaid is bundled and rendered client-side with
 *   securityLevel "strict" (no interaction, no external network inside the
 *   diagram), with a code-block fallback when a diagram fails to parse.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const capabilities = {
    transport: GATEWAY_PROVIDER,
    imageUnderstanding: {
      supported: false,
      reason:
        "The connected LLM transport accepts text-only messages today (no image parts). Screenshot → diagnosis/proposal flows activate automatically when the transport gains image support.",
    },
    diagramRendering: {
      supported: true,
      renderer: "mermaid@11 (securityLevel: strict, sandboxed render, code-block fallback)",
    },
  };
  return Response.json(
    { ok: true, capabilities },
    { status: 200, headers: securityHeaders() },
  );
}
