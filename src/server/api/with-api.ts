import { ZodError } from "zod";

import {
  securityHeaders,
  SECURITY_CONFIG,
} from "@/server/security/config";
import { logError, logInfo } from "@/server/security/logger";

import { ApiError, jsonError } from "./envelope";
import { newRequestId } from "./request-context";

/**
 * CodeMind X V2 — the one wrapper every API route handler goes through
 * (Phase 3, spec §4/§8).
 *
 * Responsibilities (in order):
 *  1. generate a fresh requestId (`req_<uuid>`) and share it with the handler;
 *  2. body-size guard: POST/PUT/PATCH with `content-length` above
 *     SECURITY_CONFIG.maxBodyBytes → 413 PAYLOAD_TOO_LARGE envelope;
 *     `allowBody: false` additionally rejects any body-carrying request (405);
 *  3. invoke the handler with `{ requestId, url, ...routeCtx }` — routeCtx is
 *     forwarded UNTOUCHED so Next 16 dynamic routes keep their typed
 *     `{ params: Promise<...> }` argument;
 *  4. map thrown errors to the consistent envelope:
 *     ApiError → its own code/status · ZodError → 422 VALIDATION_ERROR with a
 *     safe issue list · anything else → server-side log + 500 generic message;
 *  5. attach `x-request-id` + securityHeaders() to every response;
 *  6. log exactly one structured line per request (method, path, status,
 *     durationMs, requestId) — never bodies, never file contents.
 */

export interface ApiContext {
  requestId: string;
  url: URL;
}

export interface WithApiOptions {
  /**
   * Declare that this route consumes a request body. When explicitly `false`,
   * body-carrying POST/PUT/PATCH requests are rejected with 405
   * METHOD_NOT_ALLOWED (the size guard still applies to all body methods).
   */
  allowBody?: boolean;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

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
      logInfo("api request", {
        method: req.method,
        path: url.pathname,
        status: res.status,
        durationMs: Date.now() - startedAt,
        requestId,
      });
      return finalize(res, requestId);
    };

    try {
      if (BODY_METHODS.has(req.method)) {
        const rawLength = req.headers.get("content-length");
        const size = rawLength === null ? 0 : Number(rawLength);
        if (Number.isFinite(size) && size > SECURITY_CONFIG.maxBodyBytes) {
          return finish(
            jsonError(
              "PAYLOAD_TOO_LARGE",
              `Request body exceeds the ${SECURITY_CONFIG.maxBodyBytes}-byte limit.`,
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

      const res = await handler(req, apiCtx);
      return finish(res);
    } catch (error) {
      if (error instanceof ApiError) {
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
  };
}

function apiContext(requestId: string, url: URL): ApiContext {
  return { requestId, url };
}
