/**
 * CodeMind X V2 — cost/usage primitives (V2.1 §C).
 *
 * One row per real LLM call in the usage_records table. Honesty rules:
 * - token counts / cost are recorded ONLY when they actually exist on the
 *   provider response — missing fields stay null, NEVER fabricated;
 * - `recordUsage` never throws into the caller: usage logging must never
 *   break a request (failures are logged server-side and dropped).
 */

import { db } from "@/lib/db";
import { logWarn } from "@/server/security/logger";

export interface UsageRecordInput {
  requestId?: string;
  /** ChatSession.id reference (FK — invalid ids make the row drop, never fail a request). */
  sessionId?: string;
  /** AgentRun.id reference (FK). */
  runId?: string;
  jobId?: string;
  /** Gateway vocabulary, e.g. "zai-gateway" (honest label for the local SDK). */
  provider: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Only when a real price is computable — never estimated from thin air. */
  estimatedCost?: number | null;
  latencyMs?: number | null;
  /** "none" | "hit" | "miss" | "write" | "unknown" */
  cacheStatus?: string;
}

export interface RecordedUsage {
  id: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
}

interface UsageRow {
  requestId: string | null;
  sessionId: string | null;
  runId: string | null;
  jobId: string | null;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  latencyMs: number | null;
  cacheStatus: string;
}

/**
 * Write path with a stale-client fallback:
 * - normal path: the typed `db.usageRecord` delegate;
 * - fallback: raw SQL against the SAME real `usage_records` table. It exists
 *   for a server process started BEFORE the V2.1 models were pushed and the
 *   Prisma client regenerated — its in-process (globalThis-cached)
 *   PrismaClient then has no `usageRecord` delegate. The delegate path
 *   resumes automatically after the next server process reload.
 */
async function insertUsageRecord(data: UsageRow): Promise<string> {
  const delegate = (db as unknown as Record<string, unknown>).usageRecord as
    | { create: (args: unknown) => Promise<{ id: string }> }
    | undefined;
  if (delegate && typeof delegate.create === "function") {
    const row = await delegate.create({
      data,
      select: { id: true },
    });
    return row.id;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.$executeRaw`
    INSERT INTO "usage_records"
      ("id", "requestId", "sessionId", "runId", "jobId", "provider", "model",
       "inputTokens", "outputTokens", "estimatedCost", "latencyMs", "cacheStatus",
       "createdAt", "updatedAt")
    VALUES
      (${id}, ${data.requestId}, ${data.sessionId}, ${data.runId}, ${data.jobId},
       ${data.provider}, ${data.model}, ${data.inputTokens}, ${data.outputTokens},
       ${data.estimatedCost}, ${data.latencyMs}, ${data.cacheStatus}, ${now}, ${now})`;
  return id;
}

/**
 * Persist one usage record. Returns the created row id-shape, or null when
 * recording failed (already logged server-side). Never throws.
 */
export async function recordUsage(input: UsageRecordInput): Promise<RecordedUsage | null> {
  try {
    const id = await insertUsageRecord({
      requestId: input.requestId ?? null,
      sessionId: input.sessionId ?? null,
      runId: input.runId ?? null,
      jobId: input.jobId ?? null,
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      estimatedCost: input.estimatedCost ?? null,
      latencyMs: input.latencyMs ?? null,
      cacheStatus: input.cacheStatus ?? "unknown",
    });
    return {
      id,
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      latencyMs: input.latencyMs ?? null,
    };
  } catch (error) {
    logWarn("usage: record failed (request unaffected)", {
      provider: input.provider,
      model: input.model,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return null;
  }
}
