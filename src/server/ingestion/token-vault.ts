import { INGESTION_CONFIG } from "./config";
import { logInfo } from "@/server/security/logger";

/**
 * CodeMind X V2 — ephemeral import-token vault (Phase 4, spec §1).
 *
 * The spec's hard rule: an import token must NEVER be persisted, logged, or
 * echoed — it may only live inside the ephemeral clone URL/headers for the
 * git process. AnalysisJob.input is PERSISTED JSON (credentials stripped),
 * so the request token cannot ride along there. This module is the
 * process-ephemeral bridge:
 *
 *   POST /api/repositories/import ──set(jobId, token)──▶ vault (RAM only)
 *   repository.import handler   ──take(jobId)─────────▶ clone URL (ephemeral)
 *
 * Lifetime + honesty:
 * - entries are deleted as soon as the clone/extract stage finishes (success
 *   OR failure) and a TTL sweep purges leftovers lazily;
 * - the vault is RAM-only: after a server restart a re-queued import finds no
 *   token and the job FAILS HONESTLY with "import token … lost on restart"
 *   (TOKEN_UNAVAILABLE) — the user re-runs the import. The env token
 *   (CODEMIND_GITHUB_TOKEN) survives restarts and is re-read from env.
 * - the vault never logs, never serializes, never returns the token except
 *   to the handler that will embed it in the git argv.
 */

interface VaultEntry {
  token: string;
  createdAt: number;
}

const globalForVault = globalThis as unknown as {
  __cmxImportTokenVault?: Map<string, VaultEntry>;
};

function vault(): Map<string, VaultEntry> {
  if (!globalForVault.__cmxImportTokenVault) {
    globalForVault.__cmxImportTokenVault = new Map<string, VaultEntry>();
  }
  return globalForVault.__cmxImportTokenVault;
}

function sweep(): void {
  const now = Date.now();
  for (const [key, entry] of vault()) {
    if (now - entry.createdAt > INGESTION_CONFIG.tokenVaultTtlMs) {
      vault().delete(key);
    }
  }
}

/** Store the request token for a job (RAM only, TTL-bounded). */
export function vaultSet(jobId: string, token: string): void {
  sweep();
  vault().set(jobId, { token, createdAt: Date.now() });
}

/**
 * Peek (non-destructive) — the handler reads the token for every (re)run of
 * the clone stage within this process. Deleted by vaultDelete when the stage
 * completes. Returns undefined when absent (restart / TTL / already used up).
 */
export function vaultPeek(jobId: string): string | undefined {
  sweep();
  const entry = vault().get(jobId);
  return entry?.token;
}

/** Delete the entry (called when the clone stage finishes or the job ends). */
export function vaultDelete(jobId: string): void {
  if (vault().delete(jobId)) {
    logInfo("ingestion: token vault entry released", {});
  }
}
