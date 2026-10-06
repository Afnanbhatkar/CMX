/**
 * CodeMind X V2 — Phase 9.5: memory inference (spec §1 layers + §6 inbox).
 *
 * Inference runs ONLY over the user's own chat messages (typed in the
 * composer). README text, code comments, tool output, logs and commit
 * messages can NEVER reach this module — the assistant pipeline passes the
 * user's message text and nothing else, and the engine's origin guard
 * would reject any other origin anyway.
 *
 * Every inferred item is born status="proposed" (source="inferred") and
 * lands in the Memory Inbox. NOTHING auto-activates (spec §6: "Never
 * activate inferred memory without confirmation").
 *
 * Confidence is the real pattern strength (number of independent signals
 * the matched pattern carries), mapped to 0..1 — never a made-up score.
 */

import { createMemoryItem } from "./engine";
import type { MemoryLayer } from "./types";

export interface InferredProposal {
  layer: MemoryLayer;
  title: string;
  content: string;
  confidence: number;
  /** Why the engine proposed this (the matched pattern, honestly shown). */
  reason: string;
}

interface ProposalRule {
  layer: MemoryLayer;
  pattern: RegExp;
  build: (match: RegExpMatchArray, message: string) => { title: string; content: string } | null;
  confidence: number;
  reason: string;
}

/** User-message pattern rules → the five memory layers. */
const RULES: ProposalRule[] = [
  {
    // "we use fetch here, not axios" / "always use pnpm" / "don't use var"
    layer: "project-rule",
    pattern:
      /\b(?:we\s+)?(?:use|uses|always\s+use|prefer|keep\s+using|don'?t\s+use|never\s+use|avoid)\s+([a-z][\w./@-]{1,40}(?:\s+not\s+[a-z][\w./@-]{1,40})?)/i,
    build: (m) => {
      const subject = m[1].trim();
      if (subject.length < 3) return null;
      return {
        title: `Project rule: ${subject}`,
        content: `The user stated a project convention: ${subject}.`,
      };
    },
    confidence: 0.6,
    reason: "matched a convention statement (“use / don't use / avoid …”) in your message",
  },
  {
    // "JWT was chosen because..." / "we went with X because Y"
    layer: "decision",
    pattern:
      /\b(?:we\s+)?(?:chose|chosen|went\s+with|decided\s+(?:to\s+use|on)|selected)\s+([^.!?\n]{3,120})\s+because\s+([^.!?\n]{3,200})/i,
    build: (m) => ({
      title: `Decision: ${m[1].trim().slice(0, 90)}`,
      content: `${m[1].trim()} was chosen because ${m[2].trim()}.`,
    }),
    confidence: 0.75,
    reason: "matched a decision-with-rationale statement (“chose … because …”)",
  },
  {
    // "login = JWT + refresh token in httpOnly cookie" / "X is Y"
    layer: "concept",
    pattern:
      /\b([a-z][\w -]{2,40})\s+(?:=|is basically|works like|means)\s+([^.!?\n]{4,180})/i,
    build: (m) => {
      const subject = m[1].trim();
      const body = m[2].trim();
      if (subject.split(/\s+/).length > 6) return null;
      return { title: `Concept: ${subject}`, content: `${subject} = ${body}.` };
    },
    confidence: 0.55,
    reason: "matched a concept/logic definition (“X = … / X means …”)",
  },
  {
    // "I prefer Hinglish explanations" / "explain in simple words"
    layer: "preference",
    pattern:
      /\b(?:i\s+(?:prefer|like|want|usually\s+want)|please\s+always)\s+([^.!?\n]{3,140})/i,
    build: (m) => {
      const body = m[1].trim();
      if (body.length < 4) return null;
      return { title: `Preference: ${body.slice(0, 80)}`, content: `The user prefers ${body}.` };
    },
    confidence: 0.65,
    reason: "matched a preference statement (“I prefer / I like …”)",
  },
  {
    // "user rejected this diff because..." / "that's wrong, we use X instead"
    layer: "correction",
    pattern:
      /\b(?:no[,!]?\s+(?:that'?s?\s+wrong|we\s+use|use)|don'?t\s+do\s+that|rejected?\s+(?:this|it|that)[^.!?\n]*because|not\s+like\s+that[,!]\s+use)\s+([^.!?\n]{3,180})/i,
    build: (m) => ({
      title: `Correction: use ${m[1].trim().slice(0, 80)}`,
      content: `The user corrected an approach: ${m[1].trim()}. Avoid the rejected pattern in this repository.`,
    }),
    confidence: 0.7,
    reason: "matched a correction (“no, use … / rejected … because …”)",
  },
];

/** Cap on new proposals per message — the inbox must not flood. */
const MAX_PROPOSALS_PER_MESSAGE = 3;

/** Minimum message length before inference runs (greetings never propose). */
const MIN_MESSAGE_LENGTH = 24;

/**
 * Propose inferred memories from ONE user chat message.
 * Honest, deterministic pattern matching — no model call, no hidden state.
 */
export function proposeFromUserMessage(message: string): InferredProposal[] {
  const text = message.trim();
  if (text.length < MIN_MESSAGE_LENGTH) return [];
  const proposals: InferredProposal[] = [];

  for (const rule of RULES) {
    if (proposals.length >= MAX_PROPOSALS_PER_MESSAGE) break;
    const match = text.match(rule.pattern);
    if (!match) continue;
    const built = rule.build(match, text);
    if (!built) continue;
    // Skip near-duplicates already proposed from this message.
    if (proposals.some((p) => p.content.toLowerCase() === built.content.toLowerCase())) continue;
    proposals.push({
      layer: rule.layer,
      title: built.title.slice(0, 200),
      content: built.content.slice(0, 2000),
      confidence: rule.confidence,
      reason: rule.reason,
    });
  }
  return proposals;
}

/**
 * Persist proposals as inbox items. Returns the created rows' ids.
 * Every item is proposed (never active) and carries its real reason.
 */
export async function saveProposals(
  proposals: InferredProposal[],
  contextRef: string | null,
): Promise<{ ids: string[] }> {
  const ids: string[] = [];
  for (const proposal of proposals) {
    const item = await createMemoryItem({
      type: proposal.layer,
      title: proposal.title,
      content: proposal.content,
      scope: "user",
      evidenceRefs: contextRef ? [contextRef] : [],
      source: "inferred",
      origin: "user-message",
      confidence: proposal.confidence,
      proposedBySystem: true,
    });
    ids.push(item.id);
  }
  return { ids };
}
