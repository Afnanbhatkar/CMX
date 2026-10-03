/**
 * CodeMind X V2 — Phase 7 retrieval capability labels (V2.1 §D honesty).
 *
 * The single source of truth for what the search UI may claim about its
 * engines. The semantic layer is REAL but LOCAL (hashed n-gram dense
 * vectors) — the platform SDK exposes no embedding endpoint, and the UI must
 * say exactly that instead of implying a neural embedding model.
 */

export const CAPABILITY_LABELS = {
  lexical: {
    label: "BM25 (lexical)",
    source: "computed",
    note: "Okapi BM25 over an inverted index of the real workspace files and symbol names.",
  },
  semantic: {
    label: "Semantic (local hashed n-gram vectors)",
    source: "computed",
    note: "Dense vectors built by feature hashing (unigrams+bigrams, idf-weighted, cosine). Local and deterministic — no external embedding model; a neural embedder is a planned swap-in of the dense module only.",
  },
  symbol: {
    label: "Symbols (structural scan)",
    source: "computed",
    note: "Real symbol table from the deterministic code structure scanner (tree-sitter on the client parse worker; same scanner basis server-side).",
  },
  path: {
    label: "Path relevance",
    source: "computed",
    note: "File path and basename matching against the real workspace tree.",
  },
  graph: {
    label: "Import graph",
    source: "computed",
    note: "Resolved relative/@/ import edges of the real workspace → callers/callees and dependency retrieval.",
  },
  git: {
    label: "Git context",
    source: "computed",
    note: "Current branch, working-tree status and recent commit paths via the real git CLI.",
  },
  evaluation: {
    label: "Evaluation (P@K / R@K / MRR / NDCG / latency)",
    source: "measured",
    note: "Computed over a real judgments dataset when an evaluation has been run; otherwise the API answers exactly 'Evaluation not run.'",
  },
} as const;
