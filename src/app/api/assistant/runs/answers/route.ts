import { z } from "zod";

import { securityHeaders } from "@/server/security/config";
import { logInfo } from "@/server/security/logger";
import { provideAnswers } from "@/server/services/run-answers-registry";

/**
 * POST /api/assistant/runs/answers — the 8C question-flow resume endpoint.
 *
 * When a run paused on POST /api/assistant/runs with INTAKE_QUESTIONS_REQUIRED
 * ("awaiting-answers"), this endpoint delivers the user's answers and the
 * ORIGINAL stream resumes with the same run id and seq space. The run never
 * resumes without an answer — pause/ask/resume is the whole contract.
 *
 * - 200 { ok: true }  → answers delivered; the original stream continues.
 * - 409 { ok: false } → no run is waiting (completed, cancelled, or unknown
 *   runId) — surfaced honestly to the UI.
 */

const bodySchema = z.object({
  runId: z.string().min(1).max(128),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(128),
        optionId: z.string().min(1).max(128).nullable(),
        customText: z.string().max(2_000).nullable(),
      }),
    )
    .min(1)
    .max(8),
});

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400, headers: securityHeaders() },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid answers payload." },
      { status: 400, headers: securityHeaders() },
    );
  }

  const delivered = provideAnswers(parsed.data.runId, parsed.data.answers);
  if (!delivered) {
    return Response.json(
      {
        ok: false,
        error:
          "No run is waiting for answers right now (it may have completed, failed, or been cancelled).",
      },
      { status: 409, headers: securityHeaders() },
    );
  }

  logInfo("assistant run: intake answers delivered", {
    runId: parsed.data.runId,
    answers: parsed.data.answers.length,
  });
  return Response.json({ ok: true }, { headers: securityHeaders() });
}
