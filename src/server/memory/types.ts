/**
 * CodeMind X V2 — Phase 9.5 Adaptive Memory Engine: shared contracts.
 *
 * The five memory layers (spec §1) map onto the additive MemoryItem.type
 * vocabulary:
 *   Project Rules    → "project-rule"
 *   Decision Memory  → "decision"
 *   Concept / Logic  → "concept"
 *   Preference       → "preference"
 *   Correction       → "correction"
 *
 * Precedence (spec §4 — enforced by retrieval.ts ordering + the prompt
 * wording, NEVER by model discretion):
 *   current user instruction > actual repository code/evidence >
 *   saved explicit memory > inferred memory.
 * Memory can NEVER override verified code truth — the reasoning prompts
 * label memory as tier-3/tier-4 context only.
 */

import { z } from "zod";

import type { MemoryConfidence } from "@/features/workspace/assistant/contracts";

/* ------------------------------------------------------------------ */
/* Vocabularies (mirror prisma/schema.prisma comments)                  */
/* ------------------------------------------------------------------ */

export const MEMORY_LAYERS = [
  "project-rule",
  "decision",
  "concept",
  "preference",
  "correction",
] as const;

/** All writable types = the five layers + the Phase 3 baseline vocabulary. */
export const MEMORY_TYPES = [
  ...MEMORY_LAYERS,
  "fact",
  "summary",
  "other",
] as const;

export const MEMORY_SCOPES = [
  "user",
  "repository",
  "path",
  "language",
  "team",
] as const;

export const MEMORY_SOURCES = ["explicit", "inferred"] as const;

export const MEMORY_STATUSES = [
  "proposed",
  "active",
  "disabled",
  "superseded",
  "archived",
  "deleted",
] as const;

export const MEMORY_ORIGINS = [
  "manual",
  "user-message",
  "codemind-md",
  "inbox-accept",
] as const;

export type MemoryLayer = (typeof MEMORY_LAYERS)[number];
export type MemoryType = (typeof MEMORY_TYPES)[number];
export type MemoryScope = (typeof MEMORY_SCOPES)[number];
export type MemorySource = (typeof MEMORY_SOURCES)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

/** UI label + honest description per layer (Memory panel + chip reuse). */
export const MEMORY_LAYER_META: Record<
  MemoryLayer,
  { label: string; description: string }
> = {
  "project-rule": {
    label: "Project Rule",
    description: "A convention this repository follows (e.g. “use fetch, not axios”).",
  },
  decision: {
    label: "Decision",
    description: "A recorded choice and its because (e.g. “JWT was chosen because…”).",
  },
  concept: {
    label: "Concept / Logic",
    description: "How a flow works (e.g. “login = JWT + refresh token in httpOnly cookie”).",
  },
  preference: {
    label: "Preference",
    description: "How the user likes answers (e.g. “prefer Hinglish explanations”).",
  },
  correction: {
    label: "Correction",
    description: "A rejected approach and why (e.g. “user rejected this diff because…”).",
  },
};

/* ------------------------------------------------------------------ */
/* Zod write schemas (API + engine share them)                          */
/* ------------------------------------------------------------------ */

export const memoryScopeSchema = z.enum(MEMORY_SCOPES);
export const memoryTypeSchema = z.enum(MEMORY_TYPES);
export const memorySourceSchema = z.enum(MEMORY_SOURCES);
export const memoryStatusSchema = z.enum(MEMORY_STATUSES);
export const memoryOriginSchema = z.enum(MEMORY_ORIGINS);

export const createMemoryItemSchema = z.object({
  type: memoryTypeSchema,
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(2000),
  scope: memoryScopeSchema,
  /** Required for repository/team/path/language scopes (validated in engine). */
  scopeRef: z.string().max(400).nullable().optional(),
  evidenceRefs: z.array(z.string().min(1).max(200)).max(10).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export type CreateMemoryItemInput = z.infer<typeof createMemoryItemSchema>;

export const updateMemoryItemSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(2000).optional(),
  status: memoryStatusSchema.optional(),
  evidenceRefs: z.array(z.string().min(1).max(200)).max(10).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export type UpdateMemoryItemInput = z.infer<typeof updateMemoryItemSchema>;

/* ------------------------------------------------------------------ */
/* Run-time retrieval record (extends the 8C wire contract)             */
/* ------------------------------------------------------------------ */

/** Engine-side view of one retrievable memory item. */
export interface RetrievableMemory {
  id: string;
  layer: MemoryType;
  title: string;
  content: string;
  scope: MemoryScope;
  scopeRef: string | null;
  source: MemorySource;
  confidence: MemoryConfidence;
  evidenceRefs: string[];
  /** 8C contract tier — explicit → saved-explicit-memory, inferred → inferred-memory. */
  tier: "saved-explicit-memory" | "inferred-memory";
}

export function confidenceFromScore(score: number): MemoryConfidence {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

export function parseEvidenceRefs(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is string => typeof e === "string")
      .slice(0, 10);
  } catch {
    return [];
  }
}

/** Memory-driven depth (spec §9) — stored in UserProfile.prefsJson. */
export const MEMORY_DEPTHS = ["beginner", "standard", "expert"] as const;
export type MemoryDepth = (typeof MEMORY_DEPTHS)[number];

export interface MemoryPreferences {
  /** Adaptive depth — one-click overridable per run in the composer. */
  depth: MemoryDepth;
  /** Incognito defaults for new runs (per-run toggle can still override). */
  incognitoMemoryReads: boolean;
  incognitoMemoryWrites: boolean;
  /** Run-history retention days for incognito runs (spec §13). 0 = keep. */
  retentionDays: number;
}

export const DEFAULT_MEMORY_PREFERENCES: MemoryPreferences = {
  depth: "standard",
  incognitoMemoryReads: false,
  incognitoMemoryWrites: false,
  retentionDays: 0,
};

export const memoryPreferencesSchema = z.object({
  depth: z.enum(MEMORY_DEPTHS),
  incognitoMemoryReads: z.boolean(),
  incognitoMemoryWrites: z.boolean(),
  retentionDays: z.number().int().min(0).max(365),
});

/** Preferences must never suppress safety outputs (spec §9) — hard constant. */
export const UNSUPPRESSABLE_WARNING_KINDS = [
  "security",
  "correctness",
  "data-loss",
  "approval",
] as const;
