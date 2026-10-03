/**
 * CodeMind X V2 — Phase 7 dense retrieval: local hashed n-gram vectors.
 *
 * The z-ai platform SDK exposes no embedding endpoint, so semantic relevance
 * is computed with REAL local dense vectors built by feature hashing:
 * token unigrams + bigrams → FNV-1a hash → fixed-dimension L2-normalized
 * vector with sublinear-tf + idf weighting; cosine similarity for queries.
 *
 * This is an honest, well-understood retrieval baseline (hashed bag of
 * n-grams — cf. feature hashing / hashing-trick embeddings). The capability
 * badges label it "local hashed n-gram dense vectors" and the upgrade path
 * (an external embedding model) is a planned swap of this module only.
 */

import { tokenizeForRetrieval } from "@/lib/code-intel/structure-scanner";

export const DENSE_DIM = 384;

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Extract unigram + bigram features from raw text (identifier-aware). */
function features(text: string): string[] {
  const tokens = tokenizeForRetrieval(text);
  const out: string[] = [...tokens];
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    out.push(`${tokens[i]}~${tokens[i + 1]}`);
  }
  return out;
}

/**
 * Build an L2-normalized dense vector for a unit of text.
 * `idf` maps a UNIGRAM token to its inverse document frequency (bigrams use
 * the mean of their parts) — pass an idf provider from the lexical index for
 * weighting; omit for queries without idf.
 */
export function embed(text: string, idf?: (token: string) => number): Float32Array {
  const vector = new Float32Array(DENSE_DIM);
  const feats = features(text);
  if (feats.length === 0) return vector;

  const weights = new Map<string, number>();
  for (const feat of feats) {
    let weight: number;
    if (idf) {
      if (feat.includes("~")) {
        const [a, b] = feat.split("~");
        const ia = idf(a ?? "");
        const ib = idf(b ?? "");
        weight = (ia + ib) / 2 || 0.5;
      } else {
        weight = idf(feat) || 0.5;
      }
    } else {
      weight = 1;
    }
    weights.set(feat, (weights.get(feat) ?? 0) + weight);
  }

  for (const [feat, rawWeight] of weights) {
    // sublinear tf
    const tf = Math.sqrt(rawWeight);
    const hash = fnv1a(feat);
    const bucket = hash % DENSE_DIM;
    const sign = (hash & 0x80000000) === 0 ? 1 : -1;
    vector[bucket] += sign * tf;
  }

  let norm = 0;
  for (let i = 0; i < DENSE_DIM; i += 1) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < DENSE_DIM; i += 1) vector[i] /= norm;
  }
  return vector;
}

/** Cosine similarity for L2-normalized vectors (= dot product). */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) dot += a[i] * b[i];
  return dot;
}
