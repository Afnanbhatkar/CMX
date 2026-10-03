/**
 * CodeMind X V2 — Next.js instrumentation hook (V2.1 §B).
 *
 * Registers the in-process tracing SDK once at server boot. EVERYTHING is
 * guarded: a tracing setup failure must never take the server down — the
 * server simply continues without spans. Registration itself is idempotent
 * (see setupTracing in @/server/observability/tracing).
 *
 * Honesty: this wires LOCAL tracing only (in-memory ring buffer). Nothing is
 * exported to any collector — [PLANNED].
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { setupTracing } = await import("@/server/observability/tracing");
    setupTracing();
  } catch (error) {
    console.error("[instrumentation] tracing setup failed (server continues without spans):", error);
  }
}
