/**
 * CodeMind X V2 — structured server logger (Phase 3, spec §8).
 *
 * One JSON object per line on stdout/stderr: { ts, level, msg, ...fields }.
 *
 * Privacy rules (RULES.md §9/§14, ARCHITECTURE.md §8):
 * - never log request bodies, credentials, tokens, or repository file contents;
 * - never log private model reasoning; operational labels only;
 * - error detail (message/stack) stays in the SERVER log — API error bodies
 *   never carry it (see src/server/api/envelope.ts).
 */

type LogLevel = "info" | "warn" | "error";

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ?? {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function logInfo(msg: string, fields?: Record<string, unknown>): void {
  emit("info", msg, fields);
}

export function logWarn(msg: string, fields?: Record<string, unknown>): void {
  emit("warn", msg, fields);
}

export function logError(msg: string, fields?: Record<string, unknown>): void {
  emit("error", msg, fields);
}
