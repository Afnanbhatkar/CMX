import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { securityHeaders } from "@/server/security/config";
import { InlineAIError, inlineEdit } from "@/server/services/inline-ai-service";

/**
 * POST /api/ai/inline-edit — Phase 8.75 §3/§4: Cmd/Ctrl+K inline edit.
 *
 * body: { path, language, instruction, code, prefixContext?, suffixContext? }
 * success → { ok: true, replacement, servedModel, gatewayLatencyMs }
 * failure → { ok: false, error } (400 invalid payload, 502 gateway)
 *
 * SHADOW BUFFER (§4): the route returns a PROPOSAL only. It never touches
 * the filesystem — the client renders it as an inline diff and only an
 * explicit human Accept writes to the in-memory Monaco model (this build
 * has no disk-write path at all).
 */

const bodySchema = z.object({
  path: z.string().min(1).max(512),
  language: z.string().min(1).max(64),
  instruction: z.string().min(1).max(500),
  code: z.string().min(1).max(8_000),
  prefixContext: z.string().max(800).default(""),
  suffixContext: z.string().max(400).default(""),
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
    const result = await inlineEdit(parsed.data);
    return Response.json(
      {
        ok: true,
        replacement: result.text,
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
      { ok: false, error: "The inline edit request failed. You can retry." },
      { status: 502, headers: securityHeaders() },
    );
  }
}
