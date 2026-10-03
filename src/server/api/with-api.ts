import { ZodError } from "zod";

import {
  currentTraceContext,
  setActiveSpanAttributes,
  withRequestSpan,
} from "@/server/observability/tracing";
import {
  securityHeaders,
  SECURITY_CONFIG,
} from "@/server/security/config";
import { logError, logInfo } from "@/server/security/logger";

import { ApiError, jsonError } from "./envelope";
import { newRequestId } from "./request-context";

/**
 * CodeMind X V2 — the one wrapper every API route handler goes through
 * (Phase 3, spec §4/§8; V2.1 §B tracing + §A opt-in auth).
 *
 * Responsibilities (in order):
 *  1. generate a fresh requestId (`req_<uuid>`) and share it with the handler;
 *  2. open a real "http.request" tracing span (W3C traceparent extracted from
 *     inbound headers when present; attributes: request_id, http.method,
 *     http.path — plus http.status_code once the response is known). The
 *     span's traceId is added to the structured request log line. No secrets,
 *     tokens, bodies, or file contents ever enter spans;
 *  3. OPTIONAL per-route auth (`requireAuth: true`) — resolves the auth
 *     context and rejects unauthenticated requests with a 401 UNAUTHORIZED
 *     envelope. DEFAULT IS OFF: every existing route keeps the exact public/
 *     local single-user behavior it had before V2.1 (documented in
 *     src/server/security/auth.ts);
 *  4. body-size guard: POST/PUT/PATCH with `content-length` above
 *     SECURITY_CONFIG.maxBodyBytes → 413 PAYLOAD_TOO_LARGE envelope;
 *     `allowBody: false` additionally rejects any body-carrying request (405);
 *  5. invoke the handler with `{ requestId, url, ...routeCtx }` — routeCtx is
 *     forwarded UNTOUCHED so Next 16 dynamic routes keep their typed
 *     `{ params: Promise<...> }` argument;
 *  6. map thrown errors to the consistent envelope:
 *     ApiError → its own code/status · ZodError → 422 VALIDATION_ERROR with a
 *     safe issue list · anything else → server-side log + 500 generic message;
 *  7. attach `x-request-id` + securityHeaders() to every response;
 *  8. log exactly one structured line per request (method, path, status,
 *     durationMs, requestId, traceId) — never bodies, never file contents.
 */

export interface ApiContext {
  requestId: string;
  url: URL;
  /** Present only when the route opted in via `requireAuth: true`. */
  auth?: AuthContextValue;
}

/**
 * Narrow import surface for the optional auth context (avoids a hard
 * module-level dependency cycle risk; auth.ts is still the source of truth).
 */
type AuthContextValue = import("@/server/security/auth").AuthContext;

export interface WithApiOptions {
  /**
   * Declare that this route consumes a request body. When explicitly `false`,
   * body-carrying POST/PUT/PATCH requests are rejected with 405
   * METHOD_NOT_ALLOWED (the size guard still applies to all body methods).
   */
  allowBody?: boolean;
  /**
   * Per-route body-size cap overriding SECURITY_CONFIG.maxBodyBytes (used by
   * upload endpoints, e.g. repository ZIP import). Never enforced above the
   * SECURITY_CONFIG.absoluteMaxBodyBytes ceiling.
   */
  maxBodyBytes?: number;
  /**
   * Opt-in authentication gate (V2.1 §A). When true, the request must carry
   * credentials that a CONFIGURED provider validates; otherwise a 401
   * UNAUTHORIZED envelope is returned. No route sets this today — the
   * default keeps every route byte-identical to its pre-V2.1 behavior.
   */
  requireAuth?: boolean;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/**
 * ApiError identity that survives Turbopack dev's per-entry module copies:
 * dev can compile MORE THAN ONE instance of the envelope module (route graph
 * vs another import layer), making plain `instanceof` miss real ApiErrors
 * and turn honest 4xx envelopes into 500s (observed on /api/jobs/[id]/control
 * during Phase 4 verification). The duck-type branch matches the class's
 * exact shape: Error + ApiErrorCode string + numeric status.
 */
function isApiError(error: unknown): error is ApiError {
  if (error instanceof ApiError) return true;
  if (!(error instanceof Error)) return false;
  const candidate = error as unknown as { code?: unknown; status?: unknown };
  return (
    typeof candidate.code === "string" &&
    candidate.code.length > 0 &&
    candidate.code === candidate.code.toUpperCase() &&
    typeof candidate.status === "number" &&
    candidate.status >= 400 &&
    candidate.status <= 599
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Re-emit the handler's response with correlation + security headers. */
function finalize(res: Response, requestId: string): Response {
  const headers = new Headers(res.headers);
  headers.set("x-request-id", requestId);
  for (const [key, value] of Object.entries(securityHeaders())) {
    headers.set(key, value);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export function withApi<T = unknown>(
  handler: (req: Request, ctx: ApiContext & T) => Promise<Response> | Response,
  opts?: WithApiOptions,
): (req: Request, routeCtx: T) => Promise<Response> {
  return async (req: Request, routeCtx: T): Promise<Response> => {
    const startedAt = Date.now();
    const requestId = newRequestId();
    const url = new URL(req.url);
    const apiCtx = Object.assign({}, apiContext(requestId, url), routeCtx ?? {}) as ApiContext & T;

    const finish = (res: Response): Response => {
      const traceId = currentTraceContext()?.traceId;
      setActiveSpanAttributes({ "http.status_code": res.status });
      logInfo("api request", {
        method: req.method,
        path: url.pathname,
        status: res.status,
        durationMs: Date.now() - startedAt,
        requestId,
        ...(traceId ? { traceId } : {}),
      });
      return finalize(res, requestId);
    };

    // Real request span (V2.1 §B): covers guard + handler + error mapping so
    // every route gets a trace without changing any of their behavior.
    return withRequestSpan(
      "http.request",
      { request_id: requestId, "http.method": req.method, "http.path": url.pathname },
      req.headers,
      async () => {
        try {
          if (BODY_METHODS.has(req.method)) {
            const rawLength = req.headers.get("content-length");
            const size = rawLength === null ? 0 : Number(rawLength);
            const effectiveLimit = opts?.maxBodyBytes
              ? Math.min(opts.maxBodyBytes, SECURITY_CONFIG.absoluteMaxBodyBytes)
              : SECURITY_CONFIG.maxBodyBytes;
            if (Number.isFinite(size) && size > effectiveLimit) {
              return finish(
                jsonError(
                  "PAYLOAD_TOO_LARGE",
                  `Request body exceeds the ${effectiveLimit}-byte limit.`,
                  { status: 413, requestId },
                ),
              );
            }
            if (opts?.allowBody === false && size > 0) {
              return finish(
                jsonError(
                  "METHOD_NOT_ALLOWED",
                  "This endpoint does not accept a request body.",
                  { status: 405, requestId },
                ),
              );
            }
          }

          if (opts?.requireAuth) {
            const { getAuthContext, requireAuth } = await import("@/server/security/auth");
            const auth = await getAuthContext(req);
            apiCtx.auth = requireAuth(auth); // throws 401 ApiError when unauthenticated
          }

          const res = await handler(req, apiCtx);
          return finish(res);
        } catch (error) {
          if (isApiError(error)) {
            return finish(
              jsonError(error.code, error.message, {
                status: error.status,
                requestId,
              }),
            );
          }
          if (error instanceof ZodError) {
            // Safe details only: field paths + messages. Nothing internal.
            return finish(
              jsonError("VALIDATION_ERROR", "Request validation failed.", {
                status: 422,
                requestId,
                details: error.issues.map((issue) => ({
                  path: issue.path.map(String).join("."),
                  message: issue.message,
                })),
              }),
            );
          }
          // Unknown error: log server-side with detail, answer with a generic
          // message. The client never sees internals (RULES.md §9).
          logError("api: unhandled error", {
            method: req.method,
            path: url.pathname,
            requestId,
            error: describeError(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          return finish(
            jsonError("INTERNAL_ERROR", "An internal error occurred.", {
              status: 500,
              requestId,
            }),
          );
        }
      },
    );
  };
}

function apiContext(requestId: string, url: URL): ApiContext {
  return { requestId, url };
}
