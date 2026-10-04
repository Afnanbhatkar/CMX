import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  AssistantError,
  runAssistantTurn,
} from "@/server/services/assistant-service";

/**
 * POST /api/ai/chat — thin handler over the shared assistant-service.
 *
 * Phase 8A wire contract (additive — the Phase ≤7 shapes still parse):
 *   body: { messages, context?, mode?, model? }
 *     - mode:  "search" | "code" | "agent" | "loop"  (composer mode contract)
 *     - model: requested LLM Gateway model id (gateway validates; unknown
 *              ids fail with 400, never silently remapped)
 *     - context.selectedCode: the user's exact selected code
 *     - context.attachments:  composer attachments; repository-file paths
 *              are RE-READ server-side (allowlisted) — unreadable files are
 *              reported honestly to the model, never faked
 *   success → { ok: true, content, mode, servedModel }
 *   failure → { ok: false, error } (400 invalid payload, 502 assistant)
 *
 * Scope honesty: single-turn-completion surface only; the full AI execution
 * engine is NOT implemented (see assistant-service).
 */

const COMPOSER_MODES = ["search", "code", "agent", "loop"] as const;

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
      selectedCode: z.string().max(8_000).optional(),
      attachments: z
        .array(
          z.object({
            kind: z.enum(["repository-file", "selection", "session-file"]),
            label: z.string().max(256),
            path: z.string().max(512).nullable().optional(),
          }),
        )
        .max(8)
        .optional(),
    })
    .optional(),
  mode: z.enum(COMPOSER_MODES).optional(),
  model: z.string().max(64).optional(),
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
    const { content, servedModel } = await runAssistantTurn({
      messages: parsed.data.messages,
      context: parsed.data.context,
      mode: parsed.data.mode,
      model: parsed.data.model,
    });
    return NextResponse.json({
      ok: true,
      content,
      mode: parsed.data.mode ?? "search",
      servedModel,
    });
  } catch (error) {
    if (error instanceof AssistantError && error.reason === "empty") {
      return NextResponse.json(
        { ok: false, error: "The assistant returned an empty response." },
        { status: 502 },
      );
    }
    if (error instanceof AssistantError && error.reason === "failed") {
      // Includes honest unknown-model failures from the gateway catalog.
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    }
    // Service failures are already logged inside assistant-service.
    return NextResponse.json(
      { ok: false, error: "The assistant request failed. You can retry." },
      { status: 502 },
    );
  }
}
