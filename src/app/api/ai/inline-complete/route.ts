import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { securityHeaders } from "@/server/security/config";
import { InlineAIError, inlineComplete } from "@/server/services/inline-ai-service";

/**
 * POST /api/ai/inline-complete — Phase 8.75 §1: inline code completion.
 *
 * body: { path, language, prefix, suffix?, nearbySymbols?, openTabs?,
 *         recentEdits?, selection? }   (all context budgets enforced here)
 * success → { ok: true, completion, servedModel, gatewayLatencyMs }
 * failure → { ok: false, error } (400 invalid payload, 502 gateway)
 *
 * Cancellation: the client aborts the HTTP request when the buffer changes
 * and enforces a stale-guard before showing any result — an obsolete
 * completion is never inserted (server-side mid-flight abort is not
 * supported by the transport; the discarded response harms nothing).
 */

const bodySchema = z.object({
  path: z.string().min(1).max(512),
  language: z.string().min(1).max(64),
  prefix: z.string().max(6_000),
  suffix: z.string().max(1_500).default(""),
  nearbySymbols: z.array(z.string().max(160)).max(12).default([]),
  openTabs: z.array(z.string().max(512)).max(10).default([]),
  recentEdits: z.array(z.string().max(160)).max(8).default([]),
  selection: z.string().max(2_000).nullable().default(null),
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
    const result = await inlineComplete(parsed.data);
    return Response.json(
      {
        ok: true,
        completion: result.text,
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
      { ok: false, error: "The completion request failed. You can retry." },
      { status: 502, headers: securityHeaders() },
    );
  }
}
