/**
 * CodeMind X V2 — ingestion error vocabulary (Phase 4, spec §8).
 *
 * Every failure maps to an HONEST terminal state (RULES.md §9):
 * - validation errors are thrown at POST time as ApiError 422 envelopes;
 * - job-stage failures are thrown as IngestionError; the queue persists the
 *   (already sanitized) message on the analysis_jobs row — so every message
 *   built here MUST be safe for the API response body: single line, no stack,
 *   no token, no host credentials (redactSecret is applied by throwers).
 */

export type IngestionErrorCode =
  | "INVALID_URL"
  | "INVALID_REF"
  | "INVALID_PATH"
  | "INVALID_PATTERN"
  | "INVALID_ARCHIVE"
  | "AUTH_FAILED"
  | "CLONE_FAILED"
  | "CHECKOUT_FAILED"
  | "DISK_QUOTA_EXCEEDED"
  | "MALFORMED_REPOSITORY"
  | "TOKEN_UNAVAILABLE"
  | "CANCELLED";

/** Redactable, API-safe error for every ingestion job failure. */
export class IngestionError extends Error {
  constructor(
    public readonly code: IngestionErrorCode,
    message: string,
  ) {
    // Message MUST arrive pre-redacted (see sanitize.ts redactSecret).
    super(message);
    this.name = "IngestionError";
  }
}

/** Thrown when the user (or the queue) cancelled the job mid-stage. */
export class ImportCancelledError extends Error {
  constructor() {
    super("import cancelled");
    this.name = "ImportCancelledError";
  }
}
