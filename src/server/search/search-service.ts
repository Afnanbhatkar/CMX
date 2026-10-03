/**
 * CodeMind X V2 — Phase 7 hybrid search service.
 *
 * RETRIEVAL (never one method):
 *   lexical (BM25) + dense (hashed n-gram vectors) + symbol + path + graph
 *   (import edges) + metadata filters + git context.
 *
 * FUSION:
 *   - Reciprocal Rank Fusion (RRF, k=60) with per-method priors;
 *   - Maximal Marginal Relevance (MMR, λ=0.72) for diversified results.
 *
 * Every result carries `retrievalMethod` + `whyMatched` — honest, computed
 * explanations of what actually matched (spec §5).
 *
 * The search also produces a user-visible ACTIVITY summary (safe execution
 * facts only: query, hit count, top files — never hidden reasoning).
 */

import type { SearchIndex } from "./index/search-index";
import { embed, cosine } from "./index/dense";
import {
  normalizeQuery,
  normalizedQueryText,
  resolveContext,
  type NormalizedQuery,
  type SearchContext,
  type SearchIntent,
} from "./query/normalize";
import { tokenizeForRetrieval } from "@/lib/code-intel/structure-scanner";

/* ------------------------------------------------------------------ */
/* Public result model (spec §5 + V2.1 SEARCH QUALITY FOUNDATION)      */
/* ------------------------------------------------------------------ */

/**
 * Retrieval provenance (V2.1 §B) — every result names the mechanisms that
 * actually contributed. `metadata` is listed when metadata filters
 * (language/path/scope) actively shaped the candidate set; `reranker` is
 * RESERVED for the day a real reranker runs — RRF+MMR is fusion/diversification,
 * not a learned reranker, so it is never listed today (honest absence).
 */
export type RetrievalMethod =
  | "lexical"
  | "semantic"
  | "symbol"
  | "path"
  | "graph"
  | "metadata"
  | "reranker"
  | "exact"
  | "regex"
  | "git"
  | "security"
  | "documentation";

/**
 * Honest confidence (V2.1 §D) — qualitative tiers derived from REAL fusion
 * signals (how many independent mechanisms agreed, and how strong they are).
 * Never presented as a probability; the companion `confidenceReason` states
 * the actual rule that fired.
 */
export type SearchConfidence = "high" | "probable" | "weak";

export interface SearchHit {
  file: string;
  symbol: string | null;
  lineStart: number;
  lineEnd: number;
  snippet: string;
  language: string;
  /** Normalized 0–1 relevance (RRF-fused, calibrated for display). */
  score: number;
  /** Methods that contributed to this hit. */
  retrievalMethod: RetrievalMethod[];
  /** Honest human-readable reasons ("keyword 'login' in symbol name"). */
  whyMatched: string[];
  /**
   * Honest confidence tier (V2.1 §D): "high" | "probable" | "weak" —
   * derived from real fusion agreement, never a fabricated percentage.
   */
  confidence: SearchConfidence;
  /** The actual rule that produced the confidence tier. */
  confidenceReason: string;
  /** True when the workspace git reports this file modified in the worktree. */
  gitStatus: string | null;
  intent: SearchIntent | null;
}

export interface SearchStageTimings {
  normalizeMs: number;
  retrieveMs: number;
  fuseMs: number;
  totalMs: number;
}

export interface SearchActivity {
  label: string;
  /** e.g. "14 relevant results". */
  summary: string;
  topFiles: string[];
}

export interface SearchResponse {
  ok: true;
  query: {
    /** Exactly what the user typed (V2.1 §A query contract). */
    original: string;
    raw: string;
    mode: string;
    /** The retrieval query after normalization (stopwords dropped, identifiers kept). */
    normalized: string;
    /** The interpretation-rewritten retrieval query, or null when untouched. */
    rewritten: string | null;
    /** Detected query language: "en" | "hi-en" | "hi" — detection, not translation. */
    language: "en" | "hi-en" | "hi";
    intent: SearchIntent | null;
    isHinglish: boolean;
    interpretation: string[];
    /** Real repository identity from git (V2.1 §A). */
    repository: string | null;
    /** Resolved scope of this search (V2.1 §A). */
    scope: {
      scope: string;
      language: string | null;
      pathPrefix: string | null;
    };
  };
  results: SearchHit[];
  totalHits: number;
  timings: SearchStageTimings;
  index: {
    builtAt: string;
    buildMs: number;
    files: number;
    symbols: number;
    ageMs: number;
    rebuilt: boolean;
  };
  activity: SearchActivity;
}

/* ------------------------------------------------------------------ */
/* Request model                                                       */
/* ------------------------------------------------------------------ */

export type SearchMode =
  | "auto" // hybrid (default — the engine decides the mix)
  | "natural-language"
  | "semantic"
  | "keyword"
  | "exact"
  | "symbol"
  | "filename"
  | "regex"
  | "api"
  | "dependency"
  | "git"
  | "security"
  | "documentation";

export interface SearchFilters {
  language?: string | null;
  pathPrefix?: string | null;
  /** Construct/limit scope: "all" | "code" | "tests" | "docs" | "config". */
  scope?: string | null;
}

export interface HybridSearchRequest {
  query: string;
  mode?: SearchMode;
  filters?: SearchFilters;
  context?: SearchContext;
  limit?: number;
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

interface MethodHit {
  path: string;
  /** Rank within its method (1-based). */
  rank: number;
  method: RetrievalMethod;
  why: string[];
  /** Optional line anchor for the result. */
  line?: number;
  endLine?: number;
  symbol?: string | null;
}

const RRF_K = 60;
const MMR_LAMBDA = 0.72;
const METHOD_PRIOR: Record<RetrievalMethod, number> = {
  symbol: 1.2,
  path: 1.05,
  lexical: 1.0,
  semantic: 1.0,
  graph: 0.95,
  metadata: 1.0,
  reranker: 1.0,
  exact: 1.15,
  regex: 1.0,
  git: 0.9,
  security: 0.95,
  documentation: 0.9,
};

function pathMatchesFilters(path: string, language: string, filters: SearchFilters): boolean {
  if (filters.language && language !== filters.language) return false;
  const prefix = filters.pathPrefix?.trim();
  if (prefix && !path.toLowerCase().includes(prefix.toLowerCase())) return false;
  const scope = filters.scope ?? "all";
  if (scope === "code" && /\.(md|mdx|txt|json|ya?ml|toml)$/i.test(path)) return false;
  if (scope === "tests" && !/(test|spec)/i.test(path)) return false;
  if (scope === "docs" && !/\.(md|mdx|txt)$/i.test(path)) return false;
  if (scope === "config" && !/\.(json|ya?ml|toml|prisma)$|package\.json|tsconfig/i.test(path)) return false;
  return true;
}

/** Extract a result snippet centered on the best matching line. */
function snippetFor(
  lines: string[] | null,
  startLine: number,
  endLine: number,
  tokens: string[],
): { snippet: string; lineStart: number; lineEnd: number } {
  if (!lines || lines.length === 0) {
    return { snippet: "", lineStart: startLine, lineEnd: Math.max(endLine, startLine) };
  }
  const from = Math.max(1, Math.min(startLine, lines.length));
  const to = Math.max(from, Math.min(endLine, lines.length, from + 15));
  // Prefer a line inside the span that actually contains a query token.
  let anchor = from;
  if (tokens.length > 0) {
    for (let i = from; i <= to; i += 1) {
      const line = (lines[i - 1] ?? "").toLowerCase();
      if (tokens.some((t) => line.includes(t))) {
        anchor = i;
        break;
      }
    }
  }
  const windowStart = Math.max(1, anchor - 1);
  const windowEnd = Math.min(lines.length, Math.max(anchor + 3, to));
  const snippet = lines
    .slice(windowStart - 1, windowEnd)
    .map((l) => (l.length > 240 ? `${l.slice(0, 240)}…` : l))
    .join("\n")
    .trim();
  return { snippet, lineStart: windowStart, lineEnd: windowEnd };
}

/* ------------------------------------------------------------------ */
/* Retrievers                                                          */
/* ------------------------------------------------------------------ */

function retrieveLexical(
  index: SearchIndex,
  normalized: NormalizedQuery,
  limit: number,
): MethodHit[] {
  if (normalized.keywords.length === 0) return [];
  const hits = index.lexical.query(normalized.keywords, limit, {
    requiredAny: normalized.tokens.length > 0 ? normalized.tokens : undefined,
  });
  return hits.map((hit) => {
    const doc = index.lexical.docOf(hit.id);
    const isSymbolUnit = hit.id.startsWith("sym:");
    const why = isSymbolUnit
      ? [`symbol name contains ${hit.matchedTerms.map((t) => `'${t}'`).join(" + ")}`]
      : [`keyword match: ${hit.matchedTerms.slice(0, 4).map((t) => `'${t}'`).join(", ")}`];
    const span = index.lexical.linesOf(hit.id)[0];
    return {
      path: hit.path,
      rank: 0,
      method: isSymbolUnit ? ("symbol" as const) : ("lexical" as const),
      why,
      line: span?.start,
      endLine: span?.end,
      symbol: isSymbolUnit ? hit.id.split(":")[3] ?? null : null,
      __doc: doc,
    } as MethodHit & { __doc?: unknown };
  }).map((h, i) => ({ ...h, rank: i + 1 }));
}

function retrieveDense(
  index: SearchIndex,
  normalized: NormalizedQuery,
  limit: number,
): MethodHit[] {
  if (normalized.tokens.length === 0 && normalized.injected.length === 0) return [];
  const queryText = [...normalized.tokens, ...normalized.injected].join(" ");
  const queryVector = embed(queryText);
  const scored: { path: string; score: number }[] = [];
  for (const [filePath, vector] of index.vectors) {
    const similarity = cosine(queryVector, vector);
    if (similarity > 0.02) scored.push({ path: filePath, score: similarity });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry, i) => ({
    path: entry.path,
    rank: i + 1,
    method: "semantic" as const,
    why: [`semantic similarity ${entry.score.toFixed(2)} (local hashed n-gram vectors)`],
  }));
}

function retrieveSymbols(index: SearchIndex, normalized: NormalizedQuery, limit: number): MethodHit[] {
  const raw = normalized.raw.toLowerCase();
  const hits: MethodHit[] = [];
  for (const symbol of index.symbols) {
    const name = symbol.name.toLowerCase();
    if (!name) continue;
    let why: string | null = null;
    if (name === raw) why = `exact symbol name '${symbol.name}'`;
    else if (name.includes(raw) && raw.length >= 2) why = `symbol name contains '${normalized.raw}'`;
    else if (normalized.tokens.length > 0 && normalized.tokens.every((t) => name.includes(t))) {
      why = `symbol name contains all of ${normalized.tokens.map((t) => `'${t}'`).join(", ")}`;
    }
    if (!why) continue;
    hits.push({
      path: symbol.path,
      rank: 0,
      method: "symbol",
      why: [why],
      line: symbol.line,
      endLine: symbol.endLine ?? symbol.line,
      symbol: symbol.name,
    });
    if (hits.length >= limit) break;
  }
  return hits.map((h, i) => ({ ...h, rank: i + 1 }));
}

function retrievePath(index: SearchIndex, normalized: NormalizedQuery, limit: number): MethodHit[] {
  const raw = normalized.raw.toLowerCase().replace(/\s+/g, "");
  const tokens = normalized.tokens;
  const hits: MethodHit[] = [];
  for (const file of index.files) {
    const p = file.path.toLowerCase();
    const base = p.split("/").pop() ?? p;
    let why: string | null = null;
    if (raw.length >= 2 && (p.includes(raw) || base.replace(/\.[^.]+$/, "").includes(raw))) {
      why = `path contains '${normalized.raw}'`;
    } else if (tokens.length > 1 && tokens.every((t) => p.includes(t))) {
      why = `path contains all of ${tokens.map((t) => `'${t}'`).join(", ")}`;
    }
    if (!why) continue;
    hits.push({ path: file.path, rank: 0, method: "path", why: [why] });
    if (hits.length >= limit) break;
  }
  return hits.map((h, i) => ({ ...h, rank: i + 1 }));
}

/** Graph retrieval: callers (incoming) / callees (outgoing) of a path. */
function retrieveGraph(
  index: SearchIndex,
  anchorPath: string,
  direction: "callers" | "callees",
  limit: number,
): MethodHit[] {
  const hits: MethodHit[] = [];
  if (direction === "callers") {
    for (const edge of index.graph) {
      if (edge.to === anchorPath && edge.from !== anchorPath) {
        hits.push({
          path: edge.from,
          rank: 0,
          method: "graph",
          why: [`imports ${anchorPath} (line ${edge.line})`],
          line: edge.line,
        });
      }
    }
  } else {
    for (const edge of index.graph) {
      if (edge.from === anchorPath && edge.to && edge.to !== anchorPath) {
        hits.push({
          path: edge.to,
          rank: 0,
          method: "graph",
          why: [`imported by ${anchorPath} — ${edge.specifier}`],
        });
      }
    }
  }
  return hits.slice(0, limit).map((h, i) => ({ ...h, rank: i + 1 }));
}

function retrieveExact(index: SearchIndex, query: string, limit: number): MethodHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: MethodHit[] = [];
  for (const file of index.files) {
    if (!file.content) continue;
    const lower = file.content.toLowerCase();
    let idx = lower.indexOf(needle);
    if (idx === -1) continue;
    // Count occurrences for honesty in the "why".
    let occurrences = 0;
    while (idx !== -1 && occurrences < 500) {
      occurrences += 1;
      idx = lower.indexOf(needle, idx + needle.length);
    }
    const lineNumber = file.content.slice(0, lower.indexOf(needle)).split("\n").length;
    hits.push({
      path: file.path,
      rank: 0,
      method: "exact",
      why: [`exact substring '${query.trim()}' found ${occurrences}×`],
      line: lineNumber,
    });
    if (hits.length >= limit) break;
  }
  return hits.map((h, i) => ({ ...h, rank: i + 1 }));
}

function retrieveRegex(index: SearchIndex, pattern: string, limit: number): MethodHit[] {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "gi");
  } catch {
    return [];
  }
  const hits: MethodHit[] = [];
  for (const file of index.files) {
    if (!file.content) continue;
    if (hits.length >= limit) break;
    const lines = file.content.split("\n", 20_000);
    let matches = 0;
    let firstLine: number | null = null;
    for (let i = 0; i < lines.length; i += 1) {
      regex.lastIndex = 0;
      if (regex.test(lines[i]!)) {
        matches += 1;
        if (firstLine === null) firstLine = i + 1;
        if (matches >= 200) break;
      }
      if (i > 8_000) break; // regex budget cap
    }
    if (firstLine !== null) {
      hits.push({
        path: file.path,
        rank: 0,
        method: "regex",
        why: [`regex /${pattern}/ matched ${matches} line${matches === 1 ? "" : "s"}`],
        line: firstLine,
      });
    }
  }
  return hits.map((h, i) => ({ ...h, rank: i + 1 }));
}

function retrieveApi(index: SearchIndex, normalized: NormalizedQuery, limit: number): MethodHit[] {
  const hits: MethodHit[] = [];
  const keywords = normalized.keywords.length > 0 ? normalized.keywords : [];
  for (const construct of index.constructs) {
    if (construct.kind !== "route" && construct.kind !== "api-call") continue;
    const haystack = `${construct.name ?? ""} ${construct.path}`.toLowerCase();
    if (keywords.length > 0 && !keywords.some((t) => haystack.includes(t))) continue;
    hits.push({
      path: construct.path,
      rank: 0,
      method: "lexical",
      why: [construct.kind === "route" ? `route handler ${construct.name ?? ""} (line ${construct.line})` : `API call to ${construct.name ?? ""}`],
      line: construct.line,
      endLine: construct.endLine,
    });
    if (hits.length >= limit) break;
  }
  return hits.map((h, i) => ({ ...h, rank: i + 1 }));
}

function retrieveDependency(index: SearchIndex, normalized: NormalizedQuery, limit: number): MethodHit[] {
  const keywords = normalized.keywords;
  const hits: MethodHit[] = [];
  for (const edge of index.graph) {
    const haystack = `${edge.specifier} ${edge.from}`.toLowerCase();
    if (keywords.length > 0 && !keywords.some((t) => haystack.includes(t))) continue;
    hits.push({
      path: edge.from,
      rank: 0,
      method: "graph",
      why: [`imports '${edge.specifier}' (line ${edge.line})`],
      line: edge.line,
    });
    if (hits.length >= limit) break;
  }
  // Package.json dependencies too (real config content).
  for (const file of index.files) {
    if (file.path !== "package.json" || !file.content) continue;
    for (const keyword of keywords) {
      const regex = new RegExp(`"${keyword}[\\w./-]*"\\s*:`, "i");
      const match = regex.exec(file.content);
      if (match) {
        const line = file.content.slice(0, match.index).split("\n").length;
        hits.push({
          path: file.path,
          rank: 0,
          method: "graph",
          why: [`dependency entry matching '${keyword}'`],
          line,
        });
        break;
      }
    }
  }
  return hits.slice(0, limit).map((h, i) => ({ ...h, rank: i + 1 }));
}

function retrieveGit(index: SearchIndex, normalized: NormalizedQuery, limit: number): MethodHit[] {
  const hits: MethodHit[] = [];
  const tokens = normalized.tokens.length > 0 ? normalized.tokens : normalized.keywords;
  for (const path of index.git.recentPaths) {
    if (!index.files.some((f) => f.path === path)) continue;
    const p = path.toLowerCase();
    if (tokens.length > 0 && !tokens.some((t) => p.includes(t))) continue;
    hits.push({
      path,
      rank: 0,
      method: "git",
      why: ["touched in recent commits (git log)"],
    });
    if (hits.length >= limit) break;
  }
  for (const [path, status] of index.git.status) {
    if (hits.length >= limit) break;
    if (!index.files.some((f) => f.path === path)) continue;
    hits.push({
      path,
      rank: 0,
      method: "git",
      why: [`working-tree status: ${status}`],
    });
  }
  return hits.map((h, i) => ({ ...h, rank: i + 1 }));
}

/** Security-oriented search over REAL content — pattern-based, honest. */
const SECURITY_PATTERNS: Array<{ id: string; re: RegExp; label: string }> = [
  { id: "eval", re: /\beval\s*\(/, label: "eval() usage" },
  { id: "exec", re: /\b(exec|execSync)\s*\(/, label: "child process exec" },
  { id: "secret-literal", re: /(secret|password|passwd|token|api[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i, label: "hardcoded secret-looking literal" },
  { id: "sql-concat", re: /(query|execute)\s*\(\s*[`'"].*(SELECT|INSERT|UPDATE|DELETE)/i, label: "string-concatenated SQL" },
  { id: "dangerous-html", re: /dangerouslySetInnerHTML/, label: "dangerouslySetInnerHTML" },
  { id: "env-ref", re: /process\.env\.[A-Z_]+/, label: "environment reference" },
];

function retrieveSecurity(index: SearchIndex, limit: number): MethodHit[] {
  const hits: MethodHit[] = [];
  for (const file of index.files) {
    if (!file.content) continue;
    for (const pattern of SECURITY_PATTERNS) {
      const match = pattern.re.exec(file.content);
      if (!match) continue;
      const line = file.content.slice(0, match.index).split("\n").length;
      hits.push({
        path: file.path,
        rank: 0,
        method: "security",
        why: [`pattern-based security signal: ${pattern.label} (line ${line})`],
        line,
      });
      if (hits.length >= limit) return hits.map((h, i) => ({ ...h, rank: i + 1 }));
    }
  }
  return hits.map((h, i) => ({ ...h, rank: i + 1 }));
}

function retrieveDocumentation(index: SearchIndex, normalized: NormalizedQuery, limit: number): MethodHit[] {
  const hits: MethodHit[] = [];
  const tokens = normalized.keywords;
  for (const construct of index.constructs) {
    if (construct.kind !== "documentation") continue;
    if (tokens.length > 0 && construct.name && !tokens.some((t) => construct.name!.toLowerCase().includes(t))) continue;
    hits.push({
      path: construct.path,
      rank: 0,
      method: "documentation",
      why: [construct.name ? `documentation heading '${construct.name}'` : "documentation block"],
      line: construct.line,
    });
    if (hits.length >= limit) break;
  }
  return hits.map((h, i) => ({ ...h, rank: i + 1 }));
}

/* ------------------------------------------------------------------ */
/* Fusion: RRF + MMR                                                   */
/* ------------------------------------------------------------------ */

interface FusedCandidate {
  path: string;
  rrf: number;
  methods: Map<RetrievalMethod, { rank: number; why: string[] }>;
  bestLine?: number;
  bestEndLine?: number;
  symbol?: string | null;
  vector: Float32Array | null;
}

function fuseWithRRF(methodHits: MethodHit[]): FusedCandidate[] {
  const candidates = new Map<string, FusedCandidate>();
  for (const hit of methodHits) {
    const existing = candidates.get(hit.path);
    const contribution = METHOD_PRIOR[hit.method] / (RRF_K + hit.rank);
    if (existing) {
      existing.rrf += contribution;
      const prior = existing.methods.get(hit.method);
      if (prior) {
        if (hit.rank < prior.rank) {
          prior.rank = hit.rank;
          prior.why = hit.why;
        } else {
          prior.why = [...prior.why, ...hit.why].slice(0, 4);
        }
      } else {
        existing.methods.set(hit.method, { rank: hit.rank, why: hit.why });
      }
      if (hit.line && (!existing.bestLine || hit.line < existing.bestLine)) {
        existing.bestLine = hit.line;
        existing.bestEndLine = hit.endLine;
      }
      if (hit.symbol && !existing.symbol) existing.symbol = hit.symbol;
    } else {
      const methods = new Map<RetrievalMethod, { rank: number; why: string[] }>();
      methods.set(hit.method, { rank: hit.rank, why: hit.why });
      candidates.set(hit.path, {
        path: hit.path,
        rrf: contribution,
        methods,
        bestLine: hit.line,
        bestEndLine: hit.endLine,
        symbol: hit.symbol ?? null,
        vector: null,
      });
    }
  }
  const list = [...candidates.values()].sort((a, b) => b.rrf - a.rrf);
  return list;
}

function diversifyWithMMR(candidates: FusedCandidate[], vectors: Map<string, Float32Array>, limit: number): FusedCandidate[] {
  if (candidates.length <= limit) return candidates;
  for (const candidate of candidates) {
    candidate.vector = vectors.get(candidate.path) ?? null;
  }
  const selected: FusedCandidate[] = [];
  const pool = [...candidates];
  while (selected.length < limit && pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i]!;
      const relevance = candidate.rrf;
      let maxSim = 0;
      for (const chosen of selected) {
        if (!candidate.vector || !chosen.vector) continue;
        const similarity = cosine(candidate.vector, chosen.vector);
        if (similarity > maxSim) maxSim = similarity;
      }
      const mmr = MMR_LAMBDA * relevance - (1 - MMR_LAMBDA) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIndex = i;
      }
    }
    selected.push(pool.splice(bestIndex, 1)[0]!);
  }
  return selected;
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

const METHOD_LABELS: Record<RetrievalMethod, string> = {
  lexical: "keyword",
  semantic: "Semantic",
  symbol: "symbol",
  path: "path",
  graph: "graph",
  metadata: "metadata",
  reranker: "reranker",
  exact: "exact",
  regex: "regex",
  git: "git",
  security: "security",
  documentation: "docs",
};

/**
 * Confidence derivation (V2.1 §D) — deterministic, explainable, grounded in
 * the actual fusion result. Tiers:
 *   high     — exact/symbol-name equality, or ≥3 independent mechanisms
 *              (≥2 of them strong: lexical/symbol/exact/graph/regex/security)
 *   probable — ≥2 mechanisms, or one strong mechanism
 *   weak     — a single non-strong mechanism (e.g. semantic- or path-only)
 * The reason string states the rule that fired — no numeric certainty is
 * implied anywhere.
 */
const STRONG_CONFIDENCE_METHODS = new Set<RetrievalMethod>([
  "lexical",
  "symbol",
  "exact",
  "graph",
  "regex",
  "security",
]);

function deriveConfidence(
  methods: RetrievalMethod[],
  symbol: string | null,
  normalizedRaw: string,
): { confidence: SearchConfidence; confidenceReason: string } {
  const distinct = methods.filter((m) => m !== "metadata");
  const strongCount = distinct.filter((m) => STRONG_CONFIDENCE_METHODS.has(m)).length;

  if (symbol && symbol.toLowerCase() === normalizedRaw.toLowerCase()) {
    return { confidence: "high", confidenceReason: `exact symbol name match '${symbol}'` };
  }
  if (distinct.length >= 3 && strongCount >= 2) {
    return {
      confidence: "high",
      confidenceReason: `${distinct.length} independent retrieval mechanisms agreed (${strongCount} strong)`,
    };
  }
  if (distinct.length >= 2 || strongCount >= 1) {
    return {
      confidence: "probable",
      confidenceReason:
        distinct.length >= 2
          ? `${distinct.length} retrieval mechanisms agreed`
          : `single strong signal (${distinct[0] ?? "unknown"})`,
    };
  }
  return {
    confidence: "weak",
    confidenceReason: `weak/related signal only (${distinct[0] ?? "unknown"})`,
  };
}

export async function runHybridSearch(
  index: SearchIndex,
  request: HybridSearchRequest,
): Promise<SearchResponse> {
  const t0 = performance.now();
  const limit = Math.min(Math.max(request.limit ?? 20, 1), 50);
  const mode: SearchMode = request.mode ?? "auto";
  const filters = request.filters ?? {};

  const tNorm = performance.now();
  const normalized = normalizeQuery(request.query);
  const context = resolveContext(normalized, request.context ?? {});
  const normalizeMs = performance.now() - tNorm;

  const tRetrieve = performance.now();
  const RETRIEVE_LIMIT = 60;
  let methodHits: MethodHit[] = [];

  const pushAll = (hits: MethodHit[]) => {
    methodHits.push(...hits);
  };

  const hybridModes: SearchMode[] = ["auto", "natural-language", "semantic", "keyword", "api", "dependency", "git", "security", "documentation"];

  if (mode === "exact") {
    pushAll(retrieveExact(index, request.query, RETRIEVE_LIMIT));
  } else if (mode === "regex") {
    pushAll(retrieveRegex(index, request.query, RETRIEVE_LIMIT));
  } else if (mode === "filename") {
    const nameQuery: NormalizedQuery = { ...normalized, raw: request.query };
    pushAll(retrievePath(index, nameQuery, RETRIEVE_LIMIT));
  } else if (mode === "symbol") {
    pushAll(retrieveSymbols(index, normalized, RETRIEVE_LIMIT));
    pushAll(retrieveLexical(index, normalized, RETRIEVE_LIMIT));
  } else if (hybridModes.includes(mode)) {
    // HYBRID — combine, never choose one.
    pushAll(retrieveLexical(index, normalized, RETRIEVE_LIMIT));
    pushAll(retrieveDense(index, normalized, RETRIEVE_LIMIT));
    pushAll(retrieveSymbols(index, normalized, RETRIEVE_LIMIT));
    pushAll(retrievePath(index, normalized, RETRIEVE_LIMIT));
    // Contextual graph traversal ("iske callers").
    if (context.graphRequest && context.boostedPaths.length > 0) {
      const anchor = context.boostedPaths[0]!;
      pushAll(retrieveGraph(index, anchor, context.graphRequest, RETRIEVE_LIMIT));
    }
    // Mode-specific retrievers layered on the hybrid base.
    if (mode === "api") pushAll(retrieveApi(index, normalized, RETRIEVE_LIMIT));
    if (mode === "dependency") pushAll(retrieveDependency(index, normalized, RETRIEVE_LIMIT));
    if (mode === "git") pushAll(retrieveGit(index, normalized, RETRIEVE_LIMIT));
    if (mode === "security") pushAll(retrieveSecurity(index, RETRIEVE_LIMIT));
    if (mode === "documentation") pushAll(retrieveDocumentation(index, normalized, RETRIEVE_LIMIT));
    // Flow intent pulls in import-graph neighbors of the best lexical hits.
    if (normalized.intent === "flow") {
      const topLexical = methodHits.filter((h) => h.method === "lexical").slice(0, 3);
      for (const hit of topLexical) {
        pushAll(retrieveGraph(index, hit.path, "callees", 10));
      }
    }
  }

  const retrieveMs = performance.now() - tRetrieve;

  const tFuse = performance.now();
  // Filters apply BEFORE fusion (candidate gate).
  const languageByPath = new Map(index.files.map((f) => [f.path, f.language]));
  const filteredMethodHits = methodHits.filter((hit) => {
    const language = languageByPath.get(hit.path) ?? "text";
    return pathMatchesFilters(hit.path, language, filters);
  });

  let fused = fuseWithRRF(filteredMethodHits);

  // Context boosts (context resolution, spec §10): +RRF bump. Graph results
  // from an explicit callers/callees request outrank incidental mentions.
  if (context.boostedPaths.length > 0) {
    for (const candidate of fused) {
      if (context.graphRequest && candidate.methods.has("graph")) {
        candidate.rrf += 0.016; // explicit graph request: callers/callees first
      }
      for (const boost of context.boostedPaths) {
        if (boost.endsWith("/")) {
          if (candidate.path.startsWith(boost)) candidate.rrf += 0.008;
        } else if (candidate.path === boost) {
          candidate.rrf += 0.01;
        }
      }
    }
    fused = [...fused].sort((a, b) => b.rrf - a.rrf);
  }

  // Hard relevance gate for hybrid modes: candidates must carry at least one
  // STRONG method (lexical/symbol/exact/graph/regex) unless the query is pure
  // natural language (then semantic-only candidates are allowed but ranked
  // after — they already are by RRF).
  const strongMethods: RetrievalMethod[] = ["lexical", "symbol", "exact", "graph", "regex", "security"];
  if (["auto", "natural-language"].includes(mode) && normalized.tokens.length > 0) {
    fused = fused.filter(
      (candidate) =>
        [...candidate.methods.keys()].some((m) => strongMethods.includes(m)) ||
        normalized.intent === "flow" ||
        normalized.intent === "files",
    );
  }

  const diversified = diversifyWithMMR(fused, index.vectors, limit);

  // Build final results (real snippets, real line spans, honest whys).
  const maxRrf = diversified[0]?.rrf ?? 1;
  // V2.1 §B provenance: when metadata filters actively shaped the candidate
  // set, "metadata" is a real contributing mechanism and is listed.
  const filtersActive = Boolean(
    filters.language || filters.pathPrefix?.trim() || (filters.scope && filters.scope !== "all"),
  );
  const results: SearchHit[] = diversified.map((candidate) => {
    const language = languageByPath.get(candidate.path) ?? "text";
    const tokens = [...normalized.tokens, ...normalized.injected];
    const anchorLine = candidate.bestLine ?? 1;
    const endLine = candidate.bestEndLine ?? Math.max(anchorLine, anchorLine + 2);
    const { snippet, lineStart, lineEnd } = snippetFor(
      index.contentOf(candidate.path),
      anchorLine,
      endLine,
      tokens,
    );
    const methods = [...candidate.methods.keys()];
    const { confidence, confidenceReason } = deriveConfidence(
      methods,
      candidate.symbol ?? null,
      normalized.raw,
    );
    const whyMatched = [...candidate.methods.values()]
      .flatMap((m) => m.why)
      .slice(0, 4);
    if (context.notes.length > 0 && methods.includes("graph")) {
      whyMatched.push(...context.notes.slice(0, 1));
    }
    const gitStatus = index.git.status.get(candidate.path) ?? null;
    return {
      file: candidate.path,
      symbol: candidate.symbol ?? null,
      lineStart,
      lineEnd,
      snippet,
      language,
      score: maxRrf > 0 ? Math.min(1, candidate.rrf / maxRrf) : 0,
      retrievalMethod: filtersActive ? [...methods, "metadata" as const] : methods,
      whyMatched,
      confidence,
      confidenceReason,
      gitStatus,
      intent: normalized.intent,
    };
  });
  const fuseMs = performance.now() - tFuse;

  const totalMs = performance.now() - t0;
  const interpretationNotes = [...normalized.notes, ...context.notes];
  if (normalized.intent !== "general") {
    interpretationNotes.push(`intent: ${normalized.intent}`);
  }

  // V2.1 §A query contract: preserve original → normalized → rewritten, plus
  // detected language, intent, repository and scope. `rewritten` is honest:
  // non-null only when the interpretation actually injected retrieval terms.
  const normalizedText = normalizedQueryText(normalized);
  const rewritten = normalized.injected.length > 0 ? normalizedText : null;

  return {
    ok: true,
    query: {
      original: request.query,
      raw: request.query,
      mode,
      normalized: normalizedText,
      rewritten,
      language: normalized.language,
      intent: normalized.intent,
      isHinglish: normalized.isHinglish,
      interpretation: interpretationNotes,
      repository: index.git.repository,
      scope: {
        scope: filters.scope ?? "all",
        language: filters.language ?? null,
        pathPrefix: filters.pathPrefix ?? null,
      },
    },
    results,
    totalHits: fused.length,
    timings: {
      normalizeMs: round2(normalizeMs),
      retrieveMs: round2(retrieveMs),
      fuseMs: round2(fuseMs),
      totalMs: round2(totalMs),
    },
    index: {
      builtAt: index.stats.builtAt,
      buildMs: index.stats.buildMs,
      files: index.stats.files,
      symbols: index.stats.symbols,
      ageMs: Date.now() - new Date(index.stats.builtAt).getTime(),
      rebuilt: false,
    },
    activity: {
      label: `Searching repository — "${request.query.trim().slice(0, 64)}"`,
      summary: `${results.length} relevant result${results.length === 1 ? "" : "s"}`,
      topFiles: results.slice(0, 3).map((r) => r.file),
    },
  };
}

function round2(ms: number): number {
  return Math.round(ms * 100) / 100;
}
