/**
 * CodeMind X V2 — Phase 7 query understanding: Hindi/Hinglish normalization.
 *
 * Users ask questions like:
 *   "login ka pura flow kaha hai?"        → login flow (location/flow)
 *   "user logout kaha hota hai?"          → logout implementation
 *   "payment ki saari files dikhao"       → payment-related files
 *   "ye API kaha call ho rahi hai?"       → API call sites
 *   "iske callers dikhao"                 → callers of the CURRENT file/symbol
 *
 * RULES (spec §9):
 * - Hinglish function words (ka/ki/ke/hai/hota/dikhao…) are understood and
 *   dropped — they carry grammar, not technical meaning.
 * - Technical identifiers are PRESERVED VERBATIM (login, payment, api, jwt…).
 * - No literal translation that destroys meaning: "kaha" maps to a location
 *   INTENT, not to the English word "where" stuffed into the query.
 * - Hinglish is detected lexically; English queries pass through untouched.
 */

import { tokenizeForRetrieval } from "@/lib/code-intel/structure-scanner";

/* ------------------------------------------------------------------ */
/* Intent vocabulary                                                   */
/* ------------------------------------------------------------------ */

export type SearchIntent =
  | "general" // retrieve the thing
  | "flow" // end-to-end flow ("pura flow")
  | "location" // where is X ("kaha hai")
  | "call-sites" // where is X called ("kaha call ho rahi")
  | "files" // list related files ("files dikhao")
  | "definition" // where X is defined
  | "tests" // tests for X
  | "configuration"; // config/env related

/* ------------------------------------------------------------------ */
/* Lexicon (curated, honest — a real lexicon, not magic)               */
/* ------------------------------------------------------------------ */

/** Hinglish function words that never carry technical meaning. */
const HINGLISH_STOPWORDS = new Set([
  "ka", "ki", "ke", "ko", "kaa", "hai", "hain", "ho", "hota", "hoti", "hote",
  "raha", "rahi", "rahe", "kaha", "kahaan", "kahan", "kab", "kya", "kyu", "kyun",
  "kaise", "dikhao", "dikhaao", "dikha", "dikhade", "batao", "bata", "dekho",
  "chahiye", "chahiye", "saara", "saari", "sab", "sabhi", "pura", "puri",
  "poora", "poori", "pura", "wala", "wali", "waale", "liye", "se", "me", "mein",
  "bhi", "aur", "ya", "ek", "do", "ye", "yeh", "wo", "woh", "us", "uska",
  "uski", "uske", "mera", "meri", "apna", "apni", "karo", "karna", "kar",
  "jaisa", "jaisi", "jab", "tab", "tak", "na", "nahi", "nahin", "sirf",
]);

/** Tokens whose presence marks the query as Hinglish. */
const HINGLISH_MARKERS = new Set([
  "ka", "ki", "ke", "ko", "hai", "hain", "hota", "hoti", "hote", "kaha",
  "kahaan", "kahan", "kya", "dikhao", "dikhaao", "batao", "bata", "chahiye",
  "saari", "saara", "sab", "pura", "poora", "wala", "wali", "mein", "se",
  "raha", "rahi", "rahe", "iske", "iski", "iska", "kar", "karo", "kaise",
]);

/** Anaphora — resolved against the CURRENT file/symbol context (spec §10). */
const ANAPHORA_TOKENS = new Set([
  "iske", "iska", "iski", "in", "inho", "yeh", "ye", "is", "it", "this",
  "current", "active",
]);

/** Intent phrase fragments (Hinglish + English surface forms). */
interface IntentRule {
  /** Any of these fragments (in the token stream) triggers the intent. */
  fragments: string[][];
  intent: SearchIntent;
  /** Extra English keywords injected by the interpretation. */
  inject?: string[];
}

const INTENT_RULES: IntentRule[] = [
  {
    fragments: [["call", "ho"], ["call", "hot"], ["kaha", "call"], ["call", "sites"], ["call", "site"], ["called"]],
    intent: "call-sites",
    inject: ["call"],
  },
  {
    fragments: [["pura", "flow"], ["poora", "flow"], ["puri", "flow"], ["full", "flow"], ["flow"]],
    intent: "flow",
    inject: ["flow"],
  },
  {
    fragments: [["kaha"], ["kahaan"], ["kahan"], ["where"]],
    intent: "location",
  },
  {
    fragments: [["files", "dikhao"], ["saari", "files"], ["sab", "files"], ["files"], ["file", "dikhao"]],
    intent: "files",
    inject: ["files"],
  },
  {
    fragments: [["define"], ["defined"], ["definition"], ["declaration"]],
    intent: "definition",
    inject: ["definition"],
  },
  {
    fragments: [["test"], ["tests"], ["testing"], ["spec"]],
    intent: "tests",
    inject: ["tests"],
  },
  {
    fragments: [["config"], ["configuration"], ["setting"], ["settings"], ["env"], ["environment"]],
    intent: "configuration",
    inject: ["config"],
  },
];

/** Domain lexicon: Hinglish technical phrasing → English retrieval words. */
const DOMAIN_PHRASES: Array<{ patterns: string[][]; add: string[] }> = [
  // "login ka pura flow" already injects "flow"; also map common verbs.
  { patterns: [["save", "hota"], ["save", "hoti"], ["save"], ["persist"], ["store"]], add: ["save"] },
  { patterns: [["backend"]], add: ["backend", "server", "api"] },
  { patterns: [["frontend"]], add: ["frontend", "ui", "component"] },
  { patterns: [["database"], ["db"]], add: ["database", "db"] },
  { patterns: [["logout"], ["signout"], ["sign", "out"]], add: ["logout"] },
  { patterns: [["login"], ["signin"], ["sign", "in"]], add: ["login"] },
  { patterns: [["payment"], ["payments"], ["paisa"]], add: ["payment"] },
  { patterns: [["middleware"]], add: ["middleware"] },
  { patterns: [["authentication"], ["auth"]], add: ["auth", "authentication"] },
];

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

export interface NormalizedQuery {
  raw: string;
  /** Content tokens (identifiers split, lowercased; stopwords removed). */
  tokens: string[];
  /** Primary keywords — strong terms used for the hard relevance gate. */
  keywords: string[];
  intent: SearchIntent;
  isHinglish: boolean;
  /** Honest interpretation notes (shown in the UI "why" explanations). */
  notes: string[];
  /** English keywords injected by intent/domain interpretation. */
  injected: string[];
  /** Anaphora tokens found (resolved later against the search context). */
  anaphora: string[];
}

/**
 * Normalize a raw user query into retrieval tokens + intent. Deterministic,
 * explainable (notes), and safe for pure-English queries.
 */
export function normalizeQuery(raw: string): NormalizedQuery {
  const notes: string[] = [];
  const trimmed = (raw ?? "").trim();
  const baseTokens = tokenizeForRetrieval(trimmed);

  const isHinglish = baseTokens.some((t) => HINGLISH_MARKERS.has(t));
  if (isHinglish) {
    notes.push("Hinglish query — function words (ka/ki/kaha/dikhao…) interpreted, technical terms preserved");
  }

  const anaphora: string[] = [];
  const contentTokens: string[] = [];
  for (const token of baseTokens) {
    if (HINGLISH_STOPWORDS.has(token)) continue;
    if (ANAPHORA_TOKENS.has(token)) {
      anaphora.push(token);
      continue;
    }
    contentTokens.push(token);
  }
  if (anaphora.length > 0) {
    notes.push(`Context reference (${anaphora.join(", ")}) resolved against the active file/symbol`);
  }

  // Intent detection over the FULL token stream (before stopword removal —
  // "call ho rahi" needs "ho"/"rahi" to match).
  let intent: SearchIntent = "general";
  const injected: string[] = [];
  outer: for (const rule of INTENT_RULES) {
    for (const fragment of rule.fragments) {
      // Contiguous subsequence match over baseTokens.
      for (let i = 0; i + fragment.length <= baseTokens.length; i += 1) {
        let ok = true;
        for (let j = 0; j < fragment.length; j += 1) {
          if (baseTokens[i + j] !== fragment[j]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          intent = rule.intent;
          for (const kw of rule.inject ?? []) {
            if (!injected.includes(kw)) injected.push(kw);
          }
          break outer;
        }
      }
    }
  }

  // Domain phrasing → injected English keywords (technical meaning kept).
  for (const phrase of DOMAIN_PHRASES) {
    for (const fragment of phrase.patterns) {
      if (fragment.length === 1 && baseTokens.includes(fragment[0]!)) {
        for (const kw of phrase.add) if (!injected.includes(kw)) injected.push(kw);
        break;
      }
      if (fragment.length > 1) {
        for (let i = 0; i + fragment.length <= baseTokens.length; i += 1) {
          let ok = true;
          for (let j = 0; j < fragment.length; j += 1) {
            if (baseTokens[i + j] !== fragment[j]) {
              ok = false;
              break;
            }
          }
          if (ok) {
            for (const kw of phrase.add) if (!injected.includes(kw)) injected.push(kw);
            break;
          }
        }
      }
    }
  }

  // Keywords: real content tokens first, then injected interpretation words.
  const keywords: string[] = [];
  for (const token of [...contentTokens, ...injected]) {
    if (!keywords.includes(token)) keywords.push(token);
    if (keywords.length >= 12) break;
  }

  return {
    raw: trimmed,
    tokens: contentTokens,
    keywords,
    intent,
    isHinglish,
    notes,
    injected,
    anaphora,
  };
}

/* ------------------------------------------------------------------ */
/* Contextual resolution (spec §10)                                    */
/* ------------------------------------------------------------------ */

export interface SearchContext {
  /** Active editor file, if any. */
  currentFile?: string | null;
  /** Active symbol name in the editor, if any. */
  currentSymbol?: string | null;
  /** Recent queries this session (conversation context signal). */
  recentQueries?: string[];
}

export interface ContextResolution {
  /** Paths boosted because of the CURRENT file/symbol context. */
  boostedPaths: string[];
  /** Tokens added from the current file/symbol (e.g. its symbol name). */
  contextualTokens: string[];
  notes: string[];
  /** Explicit graph traversal request: callers / callees of the context. */
  graphRequest: "callers" | "callees" | null;
}

/**
 * Resolve contextual references. "iske callers dikhao" while viewing
 * src/auth/session.ts → graphRequest "callers" anchored at session.ts.
 */
export function resolveContext(
  normalized: NormalizedQuery,
  context: SearchContext,
): ContextResolution {
  const resolution: ContextResolution = {
    boostedPaths: [],
    contextualTokens: [],
    notes: [],
    graphRequest: null,
  };

  const wantsCallers =
    normalized.intent === "call-sites" ||
    /\bcallers?\b/i.test(normalized.raw) ||
    /\bcalls?\b.*\b(kaha|kahan|where)\b/i.test(normalized.raw);
  const wantsCallees = /\bcallees?\b|\bimports?\b.*\b(dekho|dikhao|show)\b/i.test(normalized.raw);

  const hasAnaphora = normalized.anaphora.length > 0;
  const anchored = context.currentFile || context.currentSymbol;

  if ((wantsCallers || wantsCallees) && anchored) {
    resolution.graphRequest = wantsCallers ? "callers" : "callees";
    resolution.boostedPaths.push(...(context.currentFile ? [context.currentFile] : []));
    resolution.notes.push(
      resolution.graphRequest === "callers"
        ? `Resolved to callers of ${context.currentSymbol ?? context.currentFile} (active context)`
        : `Resolved to what ${context.currentSymbol ?? context.currentFile} imports (active context)`,
    );
  } else if (hasAnaphora && anchored) {
    // "iske …" / "this file" → boost the current file + its directory.
    if (context.currentFile) {
      resolution.boostedPaths.push(context.currentFile);
      const dir = context.currentFile.includes("/")
        ? context.currentFile.slice(0, context.currentFile.lastIndexOf("/"))
        : null;
      if (dir) resolution.boostedPaths.push(`${dir}/`);
    }
    if (context.currentSymbol) {
      resolution.contextualTokens.push(...tokenizeForRetrieval(context.currentSymbol));
    }
    resolution.notes.push(
      `Anchored to the active file${context.currentSymbol ? ` (${context.currentSymbol})` : ""}`,
    );
  } else if (wantsCallers && !anchored) {
    resolution.notes.push("Callers/callees need an active file or symbol — showing general results instead");
  }

  return resolution;
}
