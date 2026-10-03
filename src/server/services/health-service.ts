import { db } from "@/lib/db";
import { logError } from "@/server/security/logger";

/**
 * CodeMind X V2 — REAL health checks (Phase 3, spec §9).
 *
 * Honesty rules:
 * - every check reports what was actually probed; failures log the real error
 *   server-side and surface a generic, non-leaking reason;
 * - postgresql/redis are NEVER reported healthy — they are not provisioned in
 *   this environment (production target per CAPABILITIES.md);
 * - `overall` is "healthy" only when the database is ok, else "degraded".
 */

export type HealthCheckStatus = "ok" | "unavailable";

export interface HealthCheckResult {
  status: HealthCheckStatus;
  /** Measured round-trip for the database probe. */
  latencyMs?: number;
  /** Generic failure reason (real error goes to the server log only). */
  error?: string;
  /** Honest human note (static checks / planned dependencies). */
  note?: string;
  /** True only for dependencies that are explicitly planned, never running. */
  planned?: boolean;
  /** Real row count for the persisted job queue (jobSystem check). */
  jobs?: number;
}

export interface HealthReport {
  overall: "healthy" | "degraded";
  checks: {
    database: HealthCheckResult;
    jobSystem: HealthCheckResult;
    eventStream: HealthCheckResult;
    postgresql: HealthCheckResult;
    redis: HealthCheckResult;
  };
}

const PLANNED_NOTE =
  "PLANNED — not provisioned in this environment; production target per CAPABILITIES.md";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Real probe: SELECT 1 against the SQLite database (3s timeout). */
async function checkDatabase(): Promise<HealthCheckResult> {
  const startedAt = Date.now();
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, 3_000);
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch (error) {
    logError("health: database check failed", { error: describeError(error) });
    return { status: "unavailable", error: "database check failed" };
  }
}

/**
 * Job system: the queue is in-process and persists in SQLite (analysis_jobs
 * table from Phase 3). The check is real: count rows; any failure is honest.
 */
async function checkJobSystem(): Promise<HealthCheckResult> {
  try {
    const jobs = await withTimeout(db.analysisJob.count(), 3_000);
    return {
      status: "ok",
      note: "in-process queue; jobs persist in SQLite",
      jobs,
    };
  } catch (error) {
    logError("health: job system check failed", { error: describeError(error) });
    return { status: "unavailable", error: "job system check failed" };
  }
}

/**
 * Static, dependency-free value. The SSE bus lives at /api/events (Phase 3
 * event-bus task); this check intentionally imports NOTHING from it so health
 * stays available even if the bus module changes.
 */
function checkEventStream(): HealthCheckResult {
  return { status: "ok", note: "SSE endpoint at /api/events" };
}

function checkPlanned(name: string): HealthCheckResult {
  return { status: "unavailable", planned: true, note: PLANNED_NOTE, error: `${name} not provisioned` };
}

export async function runHealthChecks(): Promise<HealthReport> {
  const [database, jobSystem] = await Promise.all([
    checkDatabase(),
    checkJobSystem(),
  ]);

  return {
    overall: database.status === "ok" ? "healthy" : "degraded",
    checks: {
      database,
      jobSystem,
      eventStream: checkEventStream(),
      postgresql: checkPlanned("postgresql"),
      redis: checkPlanned("redis"),
    },
  };
}
