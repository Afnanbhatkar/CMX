import { z } from "zod";

import type { ActivityKind } from "@/types/contracts";

/**
 * CodeMind X V2 — typed event contract (Phase 3, spec §5–§7).
 *
 * A single discriminated union (`type` discriminant + `timestamp` ISO string
 * on every member) describing everything the job system, the assistant, and
 * activity tracking emit onto the process-wide event bus.
 *
 * PRIVACY CONTRACT (ARCHITECTURE.md §8, enforced here by `.strict()` schemas):
 * events carry SHORT OPERATIONAL LABELS ONLY — "Searching repository",
 * "Reading src/auth/session.ts", "Indexing repository files". They must NEVER
 * carry model chain-of-thought, private deliberation tokens, secret prompts,
 * or repository file CONTENT. `REPOSITORY_INDEXING.currentPath` carries a
 * workspace-relative path (operational metadata), never file contents.
 *
 * The zod schemas are the runtime enforcement of that contract: any event
 * that does not match its member schema (extra keys included, via `.strict()`)
 * is invalid and must not be published.
 */

/** Closed ActivityKind vocabulary, mirrored from src/types/contracts.ts. */
const ACTIVITY_KINDS = [
  "understanding",
  "search",
  "read",
  "plan",
  "code",
  "test",
  "security",
  "git",
  "architecture",
  "finalize",
] as const satisfies readonly ActivityKind[];

const activityKindSchema = z.enum(ACTIVITY_KINDS);

/** Fields present on every event (the `.strict()` schemas repeat them). */
const eventIdSchema = z.uuid();
const isoTimestampSchema = z.iso.datetime();

/* ------------------------------------------------------------------ */
/* Activity events                                                     */
/* ------------------------------------------------------------------ */

export const activityStartedEventSchema = z
  .object({
    type: z.literal("ACTIVITY_STARTED"),
    eventId: eventIdSchema,
    timestamp: isoTimestampSchema,
    /** Agent run correlation id, when the activity belongs to a run. */
    runId: z.string().min(1).max(128).optional(),
    /** Job correlation id — the AnalysisJob.publicId, when job-scoped. */
    jobId: z.string().min(1).max(64).optional(),
    activityId: z.string().min(1).max(64),
    kind: activityKindSchema,
    /** Short operational label — never model reasoning (ARCHITECTURE.md §8). */
    label: z.string().min(1).max(200),
  })
  .strict();

export const activityCompletedEventSchema = z
  .object({
    type: z.literal("ACTIVITY_COMPLETED"),
    eventId: eventIdSchema,
    timestamp: isoTimestampSchema,
    activityId: z.string().min(1).max(64),
    label: z.string().min(1).max(200).optional(),
  })
  .strict();

export const activityFailedEventSchema = z
  .object({
    type: z.literal("ACTIVITY_FAILED"),
    eventId: eventIdSchema,
    timestamp: isoTimestampSchema,
    activityId: z.string().min(1).max(64),
    /** Safe, short reason — no stacks, no internals. */
    reason: z.string().min(1).max(500),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Job lifecycle events (jobId = AnalysisJob.publicId)                 */
/* ------------------------------------------------------------------ */

const jobEventShape = {
  eventId: eventIdSchema,
  timestamp: isoTimestampSchema,
  jobId: z.string().min(1).max(64),
  jobType: z.string().min(1).max(100),
  stage: z.string().min(1).max(100).optional(),
  /** 0..1 completion fraction. */
  progress: z.number().min(0).max(1).optional(),
} as const;

export const jobQueuedEventSchema = z
  .object({ type: z.literal("JOB_QUEUED"), ...jobEventShape })
  .strict();

export const jobRunningEventSchema = z
  .object({ type: z.literal("JOB_RUNNING"), ...jobEventShape })
  .strict();

export const jobPausedEventSchema = z
  .object({ type: z.literal("JOB_PAUSED"), ...jobEventShape })
  .strict();

export const jobCancelledEventSchema = z
  .object({ type: z.literal("JOB_CANCELLED"), ...jobEventShape })
  .strict();

export const jobCompletedEventSchema = z
  .object({ type: z.literal("JOB_COMPLETED"), ...jobEventShape })
  .strict();

export const jobFailedEventSchema = z
  .object({
    type: z.literal("JOB_FAILED"),
    ...jobEventShape,
    /** Sanitized error message — single line, no stack, no internals. */
    error: z.string().min(1).max(500),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Indexing progress events                                            */
/* ------------------------------------------------------------------ */

export const repositoryIndexingEventSchema = z
  .object({
    type: z.literal("REPOSITORY_INDEXING"),
    eventId: eventIdSchema,
    timestamp: isoTimestampSchema,
    jobId: z.string().min(1).max(64),
    /** Files handled so far in this run (resumed runs include skipped work). */
    filesIndexed: z.number().int().min(0),
    totalFiles: z.number().int().min(0).optional(),
    /** Workspace-relative path only — operational metadata, never content. */
    currentPath: z.string().min(1).max(512).optional(),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Assistant run events                                                */
/* ------------------------------------------------------------------ */

export const assistantStartedEventSchema = z
  .object({
    type: z.literal("ASSISTANT_STARTED"),
    eventId: eventIdSchema,
    timestamp: isoTimestampSchema,
    runId: z.string().min(1).max(128),
  })
  .strict();

export const assistantCompletedEventSchema = z
  .object({
    type: z.literal("ASSISTANT_COMPLETED"),
    eventId: eventIdSchema,
    timestamp: isoTimestampSchema,
    runId: z.string().min(1).max(128),
  })
  .strict();

export const assistantFailedEventSchema = z
  .object({
    type: z.literal("ASSISTANT_FAILED"),
    eventId: eventIdSchema,
    timestamp: isoTimestampSchema,
    runId: z.string().min(1).max(128),
    /** Safe, short reason — never the raw model/SDK error detail. */
    reason: z.string().min(1).max(500),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Heartbeat                                                           */
/* ------------------------------------------------------------------ */

export const streamHeartbeatEventSchema = z
  .object({
    type: z.literal("STREAM_HEARTBEAT"),
    eventId: eventIdSchema,
    timestamp: isoTimestampSchema,
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Repository import progress events (Phase 4, spec §7)                */
/* ------------------------------------------------------------------ */

export const repositoryImportEventSchema = z
  .object({
    type: z.literal("REPOSITORY_IMPORT"),
    eventId: eventIdSchema,
    timestamp: isoTimestampSchema,
    jobId: z.string().min(1).max(64),
    /**
     * Import pipeline stage. "extracting" is the ZIP-upload equivalent of
     * "cloning"; "indexing" is emitted when an import pipeline runs the
     * index phase inline (the current flow chains a repository.index job —
     * its live counts surface as REPOSITORY_INDEXING events).
     */
    stage: z.enum([
      "validating",
      "authenticating",
      "cloning",
      "extracting",
      "discovering",
      "parsing",
      "indexing",
      "finalizing",
    ]),
    /** Short operational label — e.g. "Cloning repository" (privacy §8). */
    message: z.string().min(1).max(200),
    filesDiscovered: z.number().int().min(0).optional(),
    filesParsed: z.number().int().min(0).optional(),
    /** Workspace-relative path only — operational metadata, never content. */
    currentPath: z.string().min(1).max(512).optional(),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Discriminated union                                                 */
/* ------------------------------------------------------------------ */

export const codeMindEventSchema = z.discriminatedUnion("type", [
  activityStartedEventSchema,
  activityCompletedEventSchema,
  activityFailedEventSchema,
  jobQueuedEventSchema,
  jobRunningEventSchema,
  jobPausedEventSchema,
  jobCancelledEventSchema,
  jobCompletedEventSchema,
  jobFailedEventSchema,
  repositoryIndexingEventSchema,
  repositoryImportEventSchema,
  assistantStartedEventSchema,
  assistantCompletedEventSchema,
  assistantFailedEventSchema,
  streamHeartbeatEventSchema,
]);

export type ActivityStartedEvent = z.infer<typeof activityStartedEventSchema>;
export type ActivityCompletedEvent = z.infer<typeof activityCompletedEventSchema>;
export type ActivityFailedEvent = z.infer<typeof activityFailedEventSchema>;
export type JobQueuedEvent = z.infer<typeof jobQueuedEventSchema>;
export type JobRunningEvent = z.infer<typeof jobRunningEventSchema>;
export type JobPausedEvent = z.infer<typeof jobPausedEventSchema>;
export type JobCancelledEvent = z.infer<typeof jobCancelledEventSchema>;
export type JobCompletedEvent = z.infer<typeof jobCompletedEventSchema>;
export type JobFailedEvent = z.infer<typeof jobFailedEventSchema>;
export type RepositoryIndexingEvent = z.infer<typeof repositoryIndexingEventSchema>;
export type RepositoryImportEvent = z.infer<typeof repositoryImportEventSchema>;
export type AssistantStartedEvent = z.infer<typeof assistantStartedEventSchema>;
export type AssistantCompletedEvent = z.infer<typeof assistantCompletedEventSchema>;
export type AssistantFailedEvent = z.infer<typeof assistantFailedEventSchema>;
export type StreamHeartbeatEvent = z.infer<typeof streamHeartbeatEventSchema>;

export type CodeMindEvent = z.infer<typeof codeMindEventSchema>;
export type CodeMindEventType = CodeMindEvent["type"];

/**
 * Input shape for `createEvent`: one union member minus the two fields the
 * helper stamps (eventId + timestamp).
 */
export type CodeMindEventInput = {
  [K in CodeMindEventType]: Omit<Extract<CodeMindEvent, { type: K }>, "eventId" | "timestamp">;
}[CodeMindEventType];

/**
 * Stamp an event with its `eventId` (uuid) and `timestamp` (ISO 8601).
 * Callers provide only the discriminant + payload; the two invariant fields
 * are always generated here so no hand-written event can forget them.
 */
export function createEvent<T extends CodeMindEvent>(event: CodeMindEventInput): T {
  return {
    ...event,
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  } as T;
}
