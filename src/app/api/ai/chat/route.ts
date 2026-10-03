import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  AssistantError,
  runAssistantTurn,
} from "@/server/services/assistant-service";

/**
 * POST /api/ai/chat — thin handler over the shared assistant-service
 * (Phase 3 refactor). The wire contract is UNCHANGED — the frontend's
 * use-assistant-run.ts depends on exactly these shapes:
 *   success → { ok: true, content }
 *   failure → { ok: false, error } (400 invalid payload, 502 assistant)
 *
 * Scope honesty (Phase 2 spec §18): single-turn-completion surface only; the
 * full AI execution engine is NOT implemented (see assistant-service).
 */

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8_000),
      }),
    )
    .min(1)
    .max(30),
  context: z
    .object({
      repository: z.string().max(128).optional(),
      branch: z.string().max(128).optional(),
      activeFile: z.string().max(512).optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request payload." },
      { status: 400 },
    );
  }

  try {
    const { content } = await runAssistantTurn({
      messages: parsed.data.messages,
      context: parsed.data.context,
    });
    return NextResponse.json({ ok: true, content });
  } catch (error) {
    if (error instanceof AssistantError && error.reason === "empty") {
      return NextResponse.json(
        { ok: false, error: "The assistant returned an empty response." },
        { status: 502 },
      );
    }
    // Service failures are already logged inside assistant-service.
    return NextResponse.json(
      { ok: false, error: "The assistant request failed. You can retry." },
      { status: 502 },
    );
  }
}
