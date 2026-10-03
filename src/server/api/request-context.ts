/**
 * CodeMind X V2 — request correlation ids (Phase 3, spec §8).
 *
 * Every request handled by `withApi` gets a fresh id, echoed back in the
 * `x-request-id` response header and in the envelope body, so a client-reported
 * failure can be traced to exactly one structured server log line.
 */

/** Generate a new correlation id: "req_" + random UUIDv4. */
export function newRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}
