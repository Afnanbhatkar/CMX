/**
 * CodeMind X V2 — single source of truth for the workspace root on the
 * server. Small on purpose: modules import this instead of repeating
 * `process.cwd()` so the root is trivially auditable.
 */
export const PROJECT_ROOT_ABS: string = process.cwd();
