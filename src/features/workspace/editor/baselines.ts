"use client";

/**
 * CodeMind X V2 — editor baseline registry (Phase 6).
 *
 * Tracks the LOADED file content (what the file API actually returned) per
 * tab path, so the editor can compute an honest in-memory dirty flag:
 * dirty === the live buffer differs from the loaded baseline. Session-only,
 * never persisted.
 */

const baselines = new Map<string, string>();

/** Registers/refreshes the baseline (fresh load) and clears any stale one. */
export function registerEditorBaseline(path: string, content: string): void {
  baselines.set(path, content);
}

/** Removes the baseline when a tab closes (caller: RepositoryWorkspace prune). */
export function removeEditorBaseline(path: string): void {
  baselines.delete(path);
}

/** Keeps only baselines whose path is in `livePaths` (cheap session prune). */
export function pruneEditorBaselines(livePaths: string[]): void {
  if (baselines.size === 0) return;
  const live = new Set(livePaths);
  for (const key of baselines.keys()) {
    if (!live.has(key)) baselines.delete(key);
  }
}

export function getEditorBaseline(path: string): string | undefined {
  return baselines.get(path);
}
