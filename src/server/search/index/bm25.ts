/**
 * CodeMind X V2 — Phase 7 lexical retrieval: BM25 over an inverted index.
 *
 * Real Okapi BM25 (k1/b) over the tokenized index units (per-file fields
 * plus per-symbol name fields). Every score it emits is a real computation
 * over the real corpus — no hand-tuned fakes.
 */

import { tokenizeForRetrieval } from "@/lib/code-intel/structure-scanner";

export interface IndexedDoc {
  /** Index-unit id: "file:<path>" or "sym:<path>:<line>:<name>". */
  id: string;
  path: string;
  /** Token frequencies for this unit. */
  tokens: Map<string, number>;
  length: number;
  /** Line span for snippet extraction (file units). */
  lines: { start: number; end: number }[];
  kind: "file" | "symbol";
}

export interface Bm25Hit {
  id: string;
  path: string;
  score: number;
  /** Matched query terms present in this unit. */
  matchedTerms: string[];
}

export class Bm25Index {
  private docs = new Map<string, IndexedDoc>();
  private inverted = new Map<string, Map<string, number>>(); // term → (docId → tf)
  private totalLength = 0;

  get docCount(): number {
    return this.docs.size;
  }

  get avgLength(): number {
    return this.docs.size === 0 ? 0 : this.totalLength / this.docs.size;
  }

  add(doc: IndexedDoc): void {
    this.docs.set(doc.id, doc);
    this.totalLength += doc.length;
    for (const [token, tf] of doc.tokens) {
      let postings = this.inverted.get(token);
      if (!postings) {
        postings = new Map();
        this.inverted.set(token, postings);
      }
      postings.set(doc.id, tf);
    }
  }

  /** idf (BM25+: ln(1 + (N - n + 0.5) / (n + 0.5))). */
  private idf(term: string): number {
    const postings = this.inverted.get(term);
    const n = postings?.size ?? 0;
    const N = this.docs.size;
    if (N === 0 || n === 0) return 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  /** Line spans of a doc (for snippets); empty for symbol units. */
  linesOf(id: string): { start: number; end: number }[] {
    return this.docs.get(id)?.lines ?? [];
  }

  /** Raw token frequency of `token` inside doc `id` (phrase checks). */
  tf(id: string, token: string): number {
    return this.docs.get(id)?.tokens.get(token) ?? 0;
  }

  hasTerm(term: string): boolean {
    return this.inverted.has(term);
  }

  /** Query with BM25 (k1=1.4, b=0.72). Returns top `limit` by score. */
  query(
    terms: string[],
    limit: number,
    opts?: { requiredAny?: string[]; boostIds?: Map<string, number> },
  ): Bm25Hit[] {
    const k1 = 1.4;
    const b = 0.72;
    const avg = this.avgLength || 1;
    const scores = new Map<string, { score: number; matched: Set<string> }>();

    for (const term of terms) {
      const idf = this.idf(term);
      if (idf <= 0) continue;
      const postings = this.inverted.get(term);
      if (!postings) continue;
      for (const [docId, tf] of postings) {
        const doc = this.docs.get(docId)!;
        const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + (b * doc.length) / avg));
        const contribution = idf * norm;
        const entry = scores.get(docId);
        if (entry) {
          entry.score += contribution;
          entry.matched.add(term);
        } else {
          scores.set(docId, { score: contribution, matched: new Set([term]) });
        }
      }
    }

    const requiredAny = opts?.requiredAny;
    let hits: Bm25Hit[] = [];
    for (const [docId, { score, matched }] of scores) {
      // Hard relevance gate for plain keyword queries: at least one required
      // term must be present (when provided). Prevents empty-word ranking.
      if (requiredAny && requiredAny.length > 0) {
        const doc = this.docs.get(docId)!;
        const any = requiredAny.some((t) => doc.tokens.has(t));
        if (!any) continue;
      }
      const doc = this.docs.get(docId)!;
      const boost = opts?.boostIds?.get(docId) ?? 1;
      hits.push({ id: docId, path: doc.path, score: score * boost, matchedTerms: [...matched] });
    }
    hits.sort((a, b2) => b2.score - a.score);
    return hits.slice(0, limit);
  }

  /** Doc meta for result building. */
  docOf(id: string): IndexedDoc | undefined {
    return this.docs.get(id);
  }
}

/** Tokenize an index unit. */
export function tokenizeUnit(text: string): Map<string, number> {
  const tokens = new Map<string, number>();
  for (const token of tokenizeForRetrieval(text)) {
    tokens.set(token, (tokens.get(token) ?? 0) + 1);
  }
  return tokens;
}
