import { NextResponse } from "next/server";

/**
 * CodeMind X V2 — consistent API response envelope (Phase 3, spec §4/§8).
 *
 * Every API route built on `withApi` answers with exactly one of:
 *   success → { success: true,  data, requestId }
 *   failure → { success: false, error: { code, message, details? }, requestId }
 *
 * Honesty rules (RULES.md §9):
 * - error bodies NEVER include stack traces or internal error details;
 * - `details` may only carry safe zod issue summaries (field paths + messages);
 * - unknown failures are reduced to the generic INTERNAL_ERROR message.
 */

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "REPOSITORY_NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "METHOD_NOT_ALLOWED"
  | "NOT_IMPLEMENTED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

/** Typed application error that route handlers may throw; mapped by `withApi`. */
export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface JsonOkOptions {
  status?: number;
  requestId?: string;
  headers?: Record<string, string>;
}

/** Success envelope: { success: true, data, requestId? }. */
export function jsonOk<T>(data: T, opts?: JsonOkOptions): Response {
  const body: { success: true; data: T; requestId?: string } = {
    success: true,
    data,
  };
  // requestId is included only when provided (routes pass it from withApi ctx).
  if (opts?.requestId !== undefined) body.requestId = opts.requestId;
  return NextResponse.json(body, {
    status: opts?.status ?? 200,
    headers: opts?.headers,
  });
}

export interface JsonErrorOptions {
  status?: number;
  requestId?: string;
  /**
   * SAFE extras only — e.g. zod issue summaries ({ path, message }[]).
   * Never stack traces, never internal error messages, never file contents.
   */
  details?: unknown;
  headers?: Record<string, string>;
}

/** Failure envelope: { success: false, error: { code, message, details? }, requestId? }. */
export function jsonError(
  code: ApiErrorCode | string,
  message: string,
  opts?: JsonErrorOptions,
): Response {
  const error: Record<string, unknown> = { code, message };
  if (opts?.details !== undefined) error.details = opts.details;

  const body: Record<string, unknown> = { success: false, error };
  if (opts?.requestId !== undefined) body.requestId = opts.requestId;

  return NextResponse.json(body, {
    status: opts?.status ?? 400,
    headers: opts?.headers,
  });
}
