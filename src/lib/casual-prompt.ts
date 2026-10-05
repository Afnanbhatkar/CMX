/**
 * CodeMind X V2 — casual-chat prompt heuristic (Phase 9 polish).
 *
 * ONE shared definition used on BOTH sides so the behavior can never drift:
 *
 * - SERVER (assistant-service): a casual conversational prompt ("hii",
 *   "how are you", "what's your name") skips repository retrieval —
 *   searching the workspace for a greeting is noise, and the honest chain
 *   for a greeting is Thinking → answer, not a fake hunt for files.
 *
 * - CLIENT (activity chain): for a casual prompt the chain stays COLLAPSED —
 *   the user sees only the Thinking/Thought chip; the timeline (steps are
 *   still recorded and paced one by one) opens only when the USER clicks it.
 *
 * Deliberately conservative: anything that looks like a task (imperative
 * verbs, code-ish words, more than 5 words, longer than 48 chars) is NEVER
 * casual — it gets the full visible one-by-one chain.
 */

const CASUAL_RE =
  /^(hi+|hey+|hello+|helo+|hlo+|hlw+|yo|sup|oye|namaste|namaskar|gm+|gn+|good\s*(morning|afternoon|evening|night)|how\s*(are|r)\s*(you|u)|how\s*(is|'s|s)?\s*it\s*going|what\s*(is|'s|s)?\s*up|wass?up|was?sup|who\s*(are|r)\s*(you|u)|what\s*(is|'s|s)?\s*(your|ur)\s*name|what\s*should\s*i\s*call\s*you|tumhara\s*naam|aapka\s*naam|aap\s*kaun|tum\s*kaun|kaun\s*ho\s*tum|kaise\s*ho|kaisa\s*hai|kya\s*haal|kya\s*kar\s*rahe\s*ho|thanks?|thank\s*you|thx|tysm|dhanyavad|shukriya|ok+|k|kk|byee?|goodbye|alvida|see\s*(you|ya)|cool+|nice+|great|awesome|amazing|perfect)[\s!.,?~*-]*$/i;

export function isCasualPrompt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 48) return false;
  if (trimmed.split(/\s+/).length > 5) return false;
  return CASUAL_RE.test(trimmed);
}
