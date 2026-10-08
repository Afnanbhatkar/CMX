/**
 * CodeMind X V2 — casual-chat prompt heuristic (Phase 9 polish).
 *
 * ONE shared definition used on BOTH sides so the behavior can never drift:
 *
 * - SERVER (assistant-service): a casual conversational prompt ("hii",
 *   "how are you", "hi how are you", "what's your name") skips the
 *   multi-agent orchestrator entirely — a greeting must not burn a
 *   six-agent pipeline and must NEVER propose repository files.
 *
 * - CLIENT (activity chain): for a casual prompt the chain stays COLLAPSED —
 *   the user sees only the Thinking/Thought chip; the timeline (steps are
 *   still recorded and paced one by one) opens only when the USER clicks it.
 *
 * Deliberately conservative: anything that looks like a task (imperative
 * verbs, code-ish words, more than 6 words, longer than 64 chars) is NEVER
 * casual — it gets the full visible one-by-one chain.
 *
 * Multi-phrase support (agent-mode file-creation fix): a casual sentence is
 * one or more KNOWN casual phrases back to back — "hi", "how are you",
 * "hi how are you", "hey there", "ok thanks bro". A message only counts as
 * casual when the ENTIRE text is consumed by casual phrases; any leftover
 * words ("hi create a login page") make it a task.
 */

const PHRASE_SOURCE =
  "(hi+|hey+|hello+|helo+|hlo+|hlw+|yo|sup|oye|namaste|namaskar|gm+|gn+|good\\s*(morning|afternoon|evening|night)|how\\s*(are|r)\\s*(you|u)|how\\s*(are|r)\\s*(you|u)\\s*doing|how\\s*(is|'s|s)?\\s*it\\s*going|how\\s*do\\s*you\\s*do|what\\s*(is|'s|s)?\\s*up|wass?up|was?sup|who\\s*(are|r)\\s*(you|u)|what\\s*(is|'s|s)?\\s*(your|ur)\\s*name|what\\s*should\\s*i\\s*call\\s*you|tumhara\\s*naam|aapka\\s*naam|aap\\s*kaun|tum\\s*kaun|kaun\\s*ho\\s*tum|kaise\\s*ho|kaisa\\s*hai|kya\\s*haal|kya\\s*kar\\s*rahe\\s*ho|thanks?|thank\\s*you|thx|tysm|dhanyavad|shukriya|welcome|ok+|k|kk|byee?|goodbye|alvida|see\\s*(you|ya)|cool+|nice+|great|awesome|amazing|perfect|fine|good|hmm+|haha|hehe|lol|there|bro|bhai|dude|man|buddy|yaar|boss|friend|and\\s+you|what\\s+about\\s+you|i\\s+am\\s+fine|i\\s+am\\s+good)";

/** One leading casual phrase + its trailing separators. */
const PHRASE_RE = new RegExp(`^${PHRASE_SOURCE}[\\s!.,?~*-]*`, "i");

export function isCasualPrompt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 64) return false;
  if (trimmed.split(/\s+/).length > 6) return false;

  // Consume casual phrases from the start until nothing is left. The text
  // is casual ONLY when every word belonged to a known casual phrase — a
  // task with a greeting prefix ("hi create a login page") never passes.
  let rest = trimmed;
  let matched = false;
  for (;;) {
    const match = PHRASE_RE.exec(rest);
    if (!match) break;
    matched = true;
    rest = rest.slice(match[0].length);
  }
  return matched && rest.trim().length === 0;
}
