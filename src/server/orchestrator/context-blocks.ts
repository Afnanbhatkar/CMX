/**
 * CodeMind X V2 — deterministic request analysis guard.
 *
 * The orchestrator appends context blocks ([SAVED USER MEMORY …],
 * [intake answers …]) to the user's request so the LLM agents see them.
 * Those blocks are CONTEXT DATA — and the engine/coding agent run
 * DETERMINISTIC regex analyses (mutation intent, rename detection, file
 * mentions) over the same text. Memory notes quote old requests ("rename
 * greeting file to n…", "change the name and named it watchparty"), so a
 * plain "delete this attach file" could regex-match a rename against
 * TRUNCATED MEMORY TEXT — which mechanically synthesized an `examples/n.py`
 * create on every delete request (observed bug).
 *
 * Rule: every deterministic intent analysis runs on the USER'S OWN TEXT
 * only — context blocks are stripped before any regex touches the request.
 */

/** Trailing context blocks appended by the pipeline (memory / answers). */
const CONTEXT_BLOCK_RE = /\n*\[(?:SAVED USER MEMORY|intake answers)[^\]]*\][\s\S]*$/i;

/** Strip every appended context block — the request's user-authored text. */
export function stripContextBlocks(text: string): string {
  return text.replace(CONTEXT_BLOCK_RE, "").trim();
}
