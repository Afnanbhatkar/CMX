import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { securityHeaders } from "@/server/security/config";
import { InlineAIError, explainHinglish } from "@/server/services/inline-ai-service";

/**
 * POST /api/ai/explain — Phase 8.75 §5: "Explain in Hinglish" hover action.
 *
 * body: { path, language, symbol, kind?, line?, code }
 * success → { ok: true, explanation, servedModel, gatewayLatencyMs }
 * failure → { ok: false, error } (400 invalid payload, 502 gateway)
 */

const bodySchema = z.object({
  path: z.string().min(1).max(512),
  language: z.string().min(1).max(64),
  symbol: z.string().min(1).max(128),
  kind: z.string().max(32).nullable().default(null),
  line: z.number().int().min(1).max(1_000_000).nullable().default(null),
  code: z.string().min(1).max(6_000),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400, headers: securityHeaders() },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request payload." },
      { status: 400, headers: securityHeaders() },
    );
  }

  try {
    const result = await explainHinglish(parsed.data);
    return Response.json(
      {
        ok: true,
        explanation: result.text,
        servedModel: result.servedModel,
        gatewayLatencyMs: result.gatewayLatencyMs,
      },
      { status: 200, headers: securityHeaders() },
    );
  } catch (error) {
    if (error instanceof InlineAIError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 502, headers: securityHeaders() },
      );
    }
    return NextResponse.json(
      { ok: false, error: "The explanation request failed. You can retry." },
      { status: 502, headers: securityHeaders() },
    );
  }
}
