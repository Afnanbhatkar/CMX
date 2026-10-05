"use client";

/**
 * CodeMind X V2 — fuzzy matcher (Phase 5, spec §2).
 *
 * Case-insensitive subsequence scoring used by the explorer filter and the
 * code-search panel. Pure functions — no state, no I/O.
 *
 * Scoring model (higher = better):
 * - +2 per matched character
 * - +8 consecutive-run bonus (multiplied by run length, capped)
 * - +10 word-boundary bonus (match after / _ - . space or at string start)
 * - -gap penalty (0.3 per skipped character, so early dense matches win)
 */

export interface FuzzyResult {
  score: number;
  /** Matched character indices in `text`, ascending. */
  positions: number[];
}

const BOUNDARY_CHARS = new Set(["/", "_", "-", ".", " "]);

export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return null;

  const positions: number[] = [];
  let score = 0;
  let runLength = 0;
  let textIndex = 0;

  for (let qi = 0; qi < q.length; qi += 1) {
    const char = q[qi];
    let found = -1;
    while (textIndex < t.length) {
      if (t[textIndex] === char) {
        found = textIndex;
        textIndex += 1;
        break;
      }
      textIndex += 1;
    }
    if (found === -1) return null; // subsequence broken — no match

    positions.push(found);

    // Word boundary / start bonus.
    if (found === 0 || BOUNDARY_CHARS.has(t[found - 1] ?? "")) score += 10;

    // Consecutive run bonus.
    if (positions.length > 1 && found === positions[positions.length - 2] + 1) {
      runLength = Math.min(runLength + 1, 8);
      score += 8 * runLength;
    } else {
      runLength = 0;
      // Gap penalty for skipped characters.
      const prev = positions.length > 1 ? positions[positions.length - 2] : -1;
      score -= Math.round((found - prev - 1) * 0.3);
    }

    score += 2;
  }

  return { score, positions };
}

export interface FuzzyCandidate<T> {
  item: T;
  match: FuzzyResult;
}

export function fuzzyFilter<T>(
  items: readonly T[],
  getText: (item: T) => string,
  query: string,
  limit = 100,
): Array<FuzzyCandidate<T>> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const results: Array<FuzzyCandidate<T>> = [];
  for (const item of items) {
    const match = fuzzyMatch(trimmed, getText(item));
    if (match) results.push({ item, match });
    if (results.length >= limit * 4) break; // bounded scan for very large lists
  }
  results.sort((a, b) => b.match.score - a.match.score);
  return results.slice(0, limit);
}
