import { repositoryIndexJob } from "./handlers/repository-index";
import type { JobHandler } from "./types";

/**
 * CodeMind X V2 — job type registry (Phase 3, spec §5).
 *
 * Maps a job `type` string to its real handler. `enqueueJob` rejects unknown
 * types with VALIDATION_ERROR listing the registered types; the pump fails
 * rows whose type is not registered in the CURRENT runtime ("handler not
 * registered in this runtime") — the honest outcome after a restart that
 * re-queues a job whose handler module no longer exists.
 *
 * The map lives on globalThis so dev-server module reloads cannot fork the
 * registry into stale duplicates.
 */

const globalForRegistry = globalThis as unknown as {
  __cmxJobRegistry?: Map<string, JobHandler>;
};

function registry(): Map<string, JobHandler> {
  if (!globalForRegistry.__cmxJobRegistry) {
    globalForRegistry.__cmxJobRegistry = new Map<string, JobHandler>();
  }
  return globalForRegistry.__cmxJobRegistry;
}

/** Register (or replace) the handler for a job type. */
export function registerJob(type: string, handler: JobHandler): void {
  registry().set(type, handler);
}

/** The registered handler for a type, or null when unknown in this runtime. */
export function getJobHandler(type: string): JobHandler | null {
  return registry().get(type) ?? null;
}

/** All currently registered job types (sorted, for honest error messages). */
export function listRegisteredJobTypes(): string[] {
  return [...registry().keys()].sort();
}

/* Built-in real handlers. */
registerJob("repository.index", repositoryIndexJob);
