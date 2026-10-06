/**
 * CodeMind X V2 — Phase 9.5 Adaptive Memory Engine.
 *
 * The engine is the ONLY writer of MemoryItem rows. Every create path:
 *   1. passes `assertMemoryOriginAllowed` (user-authored origins only —
 *      README/comment/tool-output/log/commit text can never become memory),
 *   2. passes `assertNoSecrets` (secrets/credentials/tokens/keys refused),
 *   3. stores its real evidence refs (or none — never fabricated ones).
 *
 * Inferred memory (spec §6) NEVER activates on its own: proposals are born
 * status="proposed", live in the Memory Inbox, and need an explicit human
 * Accept (or a CODEMIND.md/manual save for explicit memory).
 *
 * Drift (spec §7) is a heuristic term-presence analysis over the REAL
 * workspace files, honestly labeled as heuristic — it can point at drift,
 * it cannot prove truth.
 */

import { db } from "@/lib/db";
import { ApiError } from "@/server/api/envelope";
import { logWarn } from "@/server/security/logger";
import {
  buildWorkspaceTree,
  isTextFile,
  readWorkspaceFile,
} from "@/lib/server/repository-fs";

import {
  createMemoryItemSchema,
  MEMORY_STATUSES,
  confidenceFromScore,
  parseEvidenceRefs,
  type MemoryOrigin,
  type MemoryPreferences,
  type MemoryScope,
  type MemoryStatus,
  type MemoryType,
  type RetrievableMemory,
  DEFAULT_MEMORY_PREFERENCES,
  memoryPreferencesSchema,
} from "./types";
import { assertMemoryOriginAllowed, assertNoSecrets } from "./secret-guard";

/* ------------------------------------------------------------------ */
/* Types for the outside world                                          */
/* ------------------------------------------------------------------ */

export interface MemoryItemView {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  scope: MemoryScope;
  scopeRef: string | null;
  source: string;
  status: MemoryStatus;
  origin: string;
  confidence: number;
  evidenceRefs: string[];
  importance: number;
  useCount: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toItemView(row: {
  id: string;
  type: string;
  title: string;
  content: string;
  scope: string;
  scopeRef: string | null;
  source: string;
  status: string;
  origin: string;
  confidence: number;
  evidenceRefsJson: string | null;
  importance: number;
  useCount: number;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MemoryItemView {
  return {
    id: row.id,
    type: row.type as MemoryType,
    title: row.title,
    content: row.content,
    scope: row.scope as MemoryScope,
    scopeRef: row.scopeRef,
    source: row.source,
    status: row.status as MemoryStatus,
    origin: row.origin,
    confidence: row.confidence,
    evidenceRefs: parseEvidenceRefs(row.evidenceRefsJson),
    importance: row.importance,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function auditMemory(
  action: string,
  itemId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorType: "user",
        action: "memory.change",
        targetType: itemId ? "memory_item" : null,
        targetId: itemId,
        metadata: JSON.stringify({ phase: "9.5", action, ...detail }),
      },
    });
  } catch (error) {
    logWarn("memory: audit log write failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Create                                                               */
/* ------------------------------------------------------------------ */

export interface CreateMemoryArgs {
  type: MemoryType;
  title: string;
  content: string;
  scope: MemoryScope;
  scopeRef?: string | null;
  evidenceRefs?: string[];
  expiresAt?: Date | null;
  source?: "explicit" | "inferred";
  origin: MemoryOrigin;
  /** Match strength for proposals (0..1); explicit saves default to 1. */
  confidence?: number;
  /** True for engine-created inbox proposals (skips the team gate audit… no — */
  /** still audited, but the actor is "system"). */
  proposedBySystem?: boolean;
  /** Subject creating the memory (team-scope permission checks). */
  subject?: string;
}

const LOCAL_SUBJECT = "local-workspace";

/** Team-scope memories require owner/maintainer membership (spec §14). */
async function assertTeamScopeAllowed(
  repositoryId: string | null,
  subject: string,
): Promise<void> {
  if (!repositoryId) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Team-scope memory requires a repository. Team memory is shared memory — it must carry repository/team scope and permissions (spec §14).",
      422,
    );
  }
  const membership = await db.repositoryMember.findUnique({
    where: { repositoryId_subject: { repositoryId, subject } },
  }).catch(() => null);
  if (!membership || !["owner", "maintainer"].includes(membership.role)) {
    throw new ApiError(
      "FORBIDDEN",
      "Team memory requires an owner or maintainer membership for this repository. No qualifying RepositoryMember record exists for this subject.",
      403,
    );
  }
}

export async function createMemoryItem(
  args: CreateMemoryArgs,
): Promise<MemoryItemView> {
  // 1. Provenance guard — the Phase 9.5 §15 rule, enforced structurally.
  assertMemoryOriginAllowed(args.origin);
  // 2. Secret guard — never store secrets/credentials/tokens/keys.
  assertNoSecrets(args.title, args.content);

  if (args.scope === "team") {
    await assertTeamScopeAllowed(args.scopeRef ?? null, args.subject ?? LOCAL_SUBJECT);
  }

  const source = args.source ?? "explicit";
  const status: MemoryStatus =
    source === "inferred" && !args.origin.includes("accept") ? "proposed" : "active";

  const row = await db.memoryItem.create({
    data: {
      type: args.type,
      title: args.title.slice(0, 200),
      content: args.content.slice(0, 2000),
      scope: args.scope,
      scopeRef: args.scopeRef ?? null,
      repositoryId: args.scope === "team" ? (args.scopeRef ?? null) : null,
      source,
      status,
      origin: args.origin,
      confidence: Math.min(1, Math.max(0, args.confidence ?? (source === "explicit" ? 1 : 0.5))),
      evidenceRefsJson: JSON.stringify((args.evidenceRefs ?? []).slice(0, 10)),
      expiresAt: args.expiresAt ?? null,
      importance: source === "explicit" ? 0.8 : 0.5,
    },
  });

  await db.memoryEvent.create({
    data: {
      itemId: row.id,
      eventType: status === "proposed" ? "proposed" : "created",
      detail: `origin=${args.origin} source=${source} scope=${args.scope}`,
    },
  });
  await auditMemory("create", row.id, {
    type: args.type,
    scope: args.scope,
    source,
    origin: args.origin,
  });

  return toItemView(row);
}

/* ------------------------------------------------------------------ */
/* List / update / delete                                               */
/* ------------------------------------------------------------------ */

export interface ListMemoryFilter {
  status?: MemoryStatus[];
  type?: MemoryType[];
  scope?: MemoryScope[];
  source?: "explicit" | "inferred";
  q?: string;
}

export async function listMemoryItems(filter: ListMemoryFilter = {}): Promise<MemoryItemView[]> {
  const rows = await db.memoryItem.findMany({
    where: {
      ...(filter.status ? { status: { in: filter.status } } : {}),
      ...(filter.type ? { type: { in: filter.type } } : {}),
      ...(filter.scope ? { scope: { in: filter.scope } } : {}),
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.q
        ? { OR: [{ title: { contains: filter.q } }, { content: { contains: filter.q } }] }
        : {}),
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 300,
  });
  return rows.map(toItemView);
}

export async function updateMemoryItem(
  id: string,
  patch: { title?: string; content?: string; status?: MemoryStatus; evidenceRefs?: string[]; expiresAt?: Date | null },
  actor: "user" | "system" = "user",
): Promise<MemoryItemView> {
  const existing = await db.memoryItem.findUnique({ where: { id } });
  if (!existing) throw new ApiError("NOT_FOUND", "Memory item not found.", 404);

  if (patch.content !== undefined || patch.title !== undefined) {
    assertNoSecrets(patch.title ?? existing.title, patch.content ?? existing.content);
  }
  if (patch.status === "active" && existing.status === "proposed") {
    throw new ApiError(
      "CONFLICT",
      "A proposed (inferred) memory must be confirmed through the Memory Inbox accept action, not a direct status edit.",
      409,
    );
  }

  const row = await db.memoryItem.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.slice(0, 200) } : {}),
      ...(patch.content !== undefined ? { content: patch.content.slice(0, 2000) } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.evidenceRefs !== undefined
        ? { evidenceRefsJson: JSON.stringify(patch.evidenceRefs.slice(0, 10)) }
        : {}),
      ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
    },
  });

  const eventType =
    patch.status === "disabled"
      ? "disabled"
      : patch.status === "active" && existing.status === "disabled"
        ? "enabled"
        : "updated";
  await db.memoryEvent.create({
    data: { itemId: id, eventType, detail: `actor=${actor}` },
  });
  await auditMemory(eventType, id, { status: patch.status ?? existing.status });
  return toItemView(row);
}

export async function deleteMemoryItem(id: string): Promise<{ id: string }> {
  const existing = await db.memoryItem.findUnique({ where: { id } });
  if (!existing) throw new ApiError("NOT_FOUND", "Memory item not found.", 404);
  await auditMemory("delete", id, { type: existing.type, scope: existing.scope });
  await db.memoryItem.delete({ where: { id } });
  return { id };
}

/* ------------------------------------------------------------------ */
/* Memory Inbox (spec §6)                                               */
/* ------------------------------------------------------------------ */

export async function listInbox(): Promise<MemoryItemView[]> {
  return listMemoryItems({ status: ["proposed"] });
}

export type InboxDecision = "accept" | "reject";

export async function decideInboxItem(
  id: string,
  decision: InboxDecision,
): Promise<MemoryItemView> {
  const existing = await db.memoryItem.findUnique({ where: { id } });
  if (!existing) throw new ApiError("NOT_FOUND", "Memory item not found.", 404);
  if (existing.status !== "proposed") {
    throw new ApiError(
      "CONFLICT",
      `Only proposed (inferred) items live in the Memory Inbox — this item is "${existing.status}".`,
      409,
    );
  }

  // Re-run the secret guard at accept time too (defense in depth).
  assertNoSecrets(existing.title, existing.content);

  const nextStatus: MemoryStatus = decision === "accept" ? "active" : "superseded";
  const row = await db.memoryItem.update({
    where: { id },
    data: {
      status: nextStatus,
      ...(decision === "accept" ? { origin: "inbox-accept" as const } : {}),
    },
  });
  await db.memoryEvent.create({
    data: {
      itemId: id,
      eventType: decision === "accept" ? "accepted" : "rejected",
      detail: `human confirmation — inferred memory ${decision === "accept" ? "activated" : "superseded (never activated)"}`,
    },
  });
  await auditMemory(`inbox-${decision}`, id, { type: existing.type });
  return toItemView(row);
}

/* ------------------------------------------------------------------ */
/* Drift detection (spec §7)                                            */
/* ------------------------------------------------------------------ */

/** Known alternative pairs for contradiction drift (heuristic aid). */
const ALTERNATIVE_PAIRS: [string, string][] = [
  ["jwt", "session"],
  ["session", "jwt"],
  ["axios", "fetch"],
  ["fetch", "axios"],
  ["moment", "dayjs"],
  ["jest", "vitest"],
  ["npm", "bun"],
  ["redux", "zustand"],
  ["javascript", "typescript"],
];

const DRIFT_STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "use", "uses", "using", "used",
  "should", "must", "will", "not", "are", "was", "were", "has", "have", "our",
  "your", "their", "from", "into", "when", "then", "than", "because", "user",
  "prefer", "always", "never", "keep", "kept", "project", "repository", "repo",
  "code", "codebase", "memory", "flow", "module", "modules", "login", "auth",
]);

function keyTerms(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !DRIFT_STOPWORDS.has(t) && !/^\d+$/.test(t)),
  )].slice(0, 8);
}

export interface DriftFinding {
  item: MemoryItemView;
  verdict: "ok" | "possible-drift" | "contradiction";
  message: string;
  /** Real counts backing the verdict (heuristic — honest numbers). */
  evidence: { term: string; files: number }[];
  filesScanned: number;
}

interface DriftCorpus {
  files: { path: string; text: string }[];
}

let driftCorpusCache: { at: number; corpus: DriftCorpus } | null = null;
const CORPUS_TTL_MS = 60_000;

async function buildDriftCorpus(): Promise<DriftCorpus> {
  if (driftCorpusCache && Date.now() - driftCorpusCache.at < CORPUS_TTL_MS) {
    return driftCorpusCache.corpus;
  }
  const tree = await buildWorkspaceTree();
  const paths: string[] = [];
  const walk = (nodes: Awaited<ReturnType<typeof buildWorkspaceTree>>) => {
    for (const node of nodes) {
      if (node.type === "dir" && node.children) walk(node.children);
      else if (node.type === "file" && isTextFile(node.path)) paths.push(node.path);
    }
  };
  walk(tree);
  // Prioritize source files: the workspace tree lists infra directories first
  // (skills/, examples/, .zscripts/…), which would otherwise crowd src/ out of
  // the 160-file cap and make every drift check report false absences.
  paths.sort((a, b) => {
    const aSrc = a.startsWith("src/") || a === "package.json" ? 0 : 1;
    const bSrc = b.startsWith("src/") || b === "package.json" ? 0 : 1;
    return aSrc - bSrc;
  });
  const files: DriftCorpus["files"] = [];
  const selected = paths.slice(0, 400);
  const reads = await Promise.all(
    selected.map((p) => readWorkspaceFile(p).catch(() => null)),
  );
  for (const read of reads) {
    if (read?.ok === true && !read.file.truncated) {
      files.push({ path: read.file.path, text: read.file.content.toLowerCase() });
    }
  }
  const corpus = { files };
  driftCorpusCache = { at: Date.now(), corpus };
  return corpus;
}

function countFilesContaining(corpus: DriftCorpus, term: string): number {
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return corpus.files.filter((f) => re.test(f.text)).length;
}

/**
 * Heuristic drift check over ACTIVE memories vs the current workspace.
 * Honest limits: term-presence analysis only — it can surface "your saved
 * concept appears outdated" candidates, it cannot decide them. The user
 * decides (Review / Update / Keep / Disable).
 */
export async function checkMemoryDrift(): Promise<{
  findings: DriftFinding[];
  filesScanned: number;
}> {
  const corpus = await buildDriftCorpus();
  const actives = await db.memoryItem.findMany({ where: { status: "active" } });
  const findings: DriftFinding[] = [];

  for (const row of actives) {
    const item = toItemView(row);
    if (item.expiresAt && new Date(item.expiresAt) < new Date()) continue;
    const terms = keyTerms(`${item.title} ${item.content}`);
    if (terms.length === 0) continue;

    const counts = terms.map((t) => ({ term: t, files: countFilesContaining(corpus, t) }));
    const present = counts.filter((c) => c.files > 0);
    const absent = counts.filter((c) => c.files === 0);
    // Distinctive terms = the RAREST terms in the corpus. Generic words that
    // happen to appear everywhere ("schemas", "change") must not mask the
    // absence of the memory's actual subject ("mongoose", "mongodb").
    // A distinctive term counts as present only above 1% corpus coverage —
    // a term in ≤ 1–3 of 358 files is noise, not evidence the concept exists.
    const rareThreshold = Math.max(3, Math.floor(corpus.files.length * 0.01));
    const distinctive = [...counts].sort((a, b) => a.files - b.files).slice(0, 4);
    const distinctiveAllAbsent = distinctive.every((c) => c.files <= rareThreshold);

    // Contradiction check: memory says A, repo overwhelmingly uses B.
    let contradiction: DriftFinding["verdict"] = "ok";
    let contradictionMessage = "";
    const lower = `${item.title} ${item.content}`.toLowerCase();
    for (const [a, b] of ALTERNATIVE_PAIRS) {
      const reA = new RegExp(`\\b${a}\\b`, "i");
      if (reA.test(lower) && a !== b) {
        const filesA = countFilesContaining(corpus, a);
        const filesB = countFilesContaining(corpus, b);
        if (filesA === 0 && filesB >= 3) {
          contradiction = "contradiction";
          contradictionMessage = `Memory says "${a}" but the current code uses "${b}" in ${filesB} files and "${a}" in none.`;
          break;
        }
      }
    }

    if (contradiction === "contradiction") {
      findings.push({
        item,
        verdict: "contradiction",
        message: contradictionMessage,
        evidence: counts.slice(0, 4),
        filesScanned: corpus.files.length,
      });
    } else if (distinctiveAllAbsent) {
      findings.push({
        item,
        verdict: "possible-drift",
        message: `This memory's most distinctive terms (${distinctive.map((c) => c.term).join(", ")}) appear in essentially no current code (≤ ${rareThreshold} of ${corpus.files.length} files each) — your saved memory appears outdated.`,
        evidence: counts.slice(0, 4),
        filesScanned: corpus.files.length,
      });
    } else {
      findings.push({
        item,
        verdict: "ok",
        message: `Key terms still present in ${present.length}/${terms.length} term checks.`,
        evidence: counts.slice(0, 4),
        filesScanned: corpus.files.length,
      });
    }
  }

  // Drift checks only observe — no memory rows change here.
  return { findings, filesScanned: corpus.files.length };
}

/** Record the user's drift decision (Review/Keep write an audit + event). */
export async function recordDriftDecision(
  id: string,
  decision: "reviewed" | "kept",
): Promise<{ id: string }> {
  const existing = await db.memoryItem.findUnique({ where: { id } });
  if (!existing) throw new ApiError("NOT_FOUND", "Memory item not found.", 404);
  await db.memoryEvent.create({
    data: {
      itemId: id,
      eventType: "drift-reviewed",
      detail: `user decided: ${decision}`,
    },
  });
  await auditMemory(`drift-${decision}`, id, {});
  return { id };
}

/* ------------------------------------------------------------------ */
/* Glossary (spec §8)                                                   */
/* ------------------------------------------------------------------ */

export interface GlossaryView {
  id: string;
  term: string;
  definition: string;
  aliases: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

function toGlossaryView(row: {
  id: string;
  term: string;
  definition: string;
  aliasesJson: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): GlossaryView {
  let aliases: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.aliasesJson ?? "[]");
    if (Array.isArray(parsed)) {
      aliases = parsed.filter((a): a is string => typeof a === "string");
    }
  } catch {
    aliases = [];
  }
  return {
    id: row.id,
    term: row.term,
    definition: row.definition,
    aliases,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listGlossary(): Promise<GlossaryView[]> {
  const rows = await db.glossaryEntry.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map(toGlossaryView);
}

export async function upsertGlossaryEntry(input: {
  id?: string;
  term: string;
  definition: string;
  aliases?: string[];
}): Promise<GlossaryView> {
  const term = input.term.trim();
  const definition = input.definition.trim();
  if (!term || !definition) {
    throw new ApiError("VALIDATION_ERROR", "Glossary term and definition are required.", 422);
  }
  // NOTE: @@unique([repositoryId, term]) cannot match NULL repositoryId rows
  // in SQLite (NULL != NULL), so the workspace-local lookup is by term only.
  const existing = await db.glossaryEntry.findFirst({
    where: { term, repositoryId: null },
  });
  const row = existing
    ? await db.glossaryEntry.update({
        where: { id: existing.id },
        data: {
          definition: definition.slice(0, 2000),
          aliasesJson: JSON.stringify((input.aliases ?? []).slice(0, 10)),
          status: "active",
        },
      })
    : await db.glossaryEntry.create({
        data: {
          term: term.slice(0, 200),
          definition: definition.slice(0, 2000),
          aliasesJson: JSON.stringify((input.aliases ?? []).slice(0, 10)),
        },
      });
  await auditMemory("glossary-upsert", row.id, { term });
  return toGlossaryView(row);
}

export async function deleteGlossaryEntry(id: string): Promise<{ id: string }> {
  const existing = await db.glossaryEntry.findUnique({ where: { id } });
  if (!existing) throw new ApiError("NOT_FOUND", "Glossary entry not found.", 404);
  await db.glossaryEntry.delete({ where: { id } });
  await auditMemory("glossary-delete", id, { term: existing.term });
  return { id };
}

/**
 * Resolve user language against the glossary (spec §8): entries whose term
 * or alias actually appears in the query are returned with their real
 * definition — used as explicit context, never as instructions.
 */
export async function resolveGlossaryForQuery(
  query: string,
): Promise<{ term: string; definition: string }[]> {
  if (!query.trim()) return [];
  const entries = await listGlossary();
  const q = query.toLowerCase();
  const hits: { term: string; definition: string }[] = [];
  for (const entry of entries) {
    const candidates = [entry.term, ...entry.aliases].map((t) => t.toLowerCase());
    if (candidates.some((t) => t.length >= 2 && q.includes(t))) {
      hits.push({ term: entry.term, definition: entry.definition });
    }
  }
  return hits.slice(0, 5);
}

/* ------------------------------------------------------------------ */
/* Preferences (spec §9 + §13)                                          */
/* ------------------------------------------------------------------ */

const PREFS_SUBJECT = LOCAL_SUBJECT;

export async function getMemoryPreferences(): Promise<MemoryPreferences> {
  const profile = await db.userProfile.findUnique({ where: { subject: PREFS_SUBJECT } });
  if (!profile?.prefsJson) return { ...DEFAULT_MEMORY_PREFERENCES };
  try {
    const parsed: unknown = JSON.parse(profile.prefsJson);
    const result = memoryPreferencesSchema.safeParse(parsed);
    return result.success ? result.data : { ...DEFAULT_MEMORY_PREFERENCES };
  } catch {
    return { ...DEFAULT_MEMORY_PREFERENCES };
  }
}

export async function updateMemoryPreferences(
  patch: Partial<MemoryPreferences>,
): Promise<MemoryPreferences> {
  const current = await getMemoryPreferences();
  const merged = memoryPreferencesSchema.parse({ ...current, ...patch });
  await db.userProfile.upsert({
    where: { subject: PREFS_SUBJECT },
    create: { subject: PREFS_SUBJECT, displayName: "Local workspace", prefsJson: JSON.stringify(merged) },
    update: { prefsJson: JSON.stringify(merged) },
  });
  await auditMemory("preferences", null, { depth: merged.depth, incognito: merged.incognitoMemoryReads || merged.incognitoMemoryWrites });
  return merged;
}

/* ------------------------------------------------------------------ */
/* Habits (spec §10) — computed from REAL chat history                  */
/* ------------------------------------------------------------------ */

export interface HabitSignal {
  id: string;
  label: string;
  /** Real count behind the signal (honest — 0 = no habit). */
  occurrences: number;
  /** Threshold at which the engine proposes a reusable workflow. */
  threshold: number;
  proposal: string | null;
}

const TEST_RE = /\b(test|tests|unit\s?test|coverage|vitest|jest)\b/i;
const CODE_CHANGE_RE = /\b(add|implement|fix|refactor|update|create|write|change)\b/i;
const EXPLAIN_RE = /\b(explain|batao|samjha|kaise|why|how does|kya)\b/i;

export async function getHabitSignals(): Promise<HabitSignal[]> {
  const messages = await db.chatMessage.findMany({
    where: { role: "user" },
    orderBy: { createdAt: "asc" },
    select: { id: true, sessionId: true, content: true, createdAt: true },
    take: 1000,
  });

  // tests-after-changes: within one session, a test ask following a change ask.
  let testsAfterChanges = 0;
  const bySession = new Map<string, string[]>();
  for (const m of messages) {
    const list = bySession.get(m.sessionId) ?? [];
    list.push(m.content);
    bySession.set(m.sessionId, list);
  }
  for (const contents of bySession.values()) {
    let sawChange = false;
    for (const c of contents) {
      if (CODE_CHANGE_RE.test(c)) sawChange = true;
      else if (sawChange && TEST_RE.test(c)) {
        testsAfterChanges += 1;
        sawChange = false;
      }
    }
  }

  const explains = messages.filter((m) => EXPLAIN_RE.test(m.content)).length;
  const total = messages.length;

  return [
    {
      id: "tests-after-changes",
      label: "You often ask for tests after code changes",
      occurrences: testsAfterChanges,
      threshold: 3,
      proposal:
        testsAfterChanges >= 3
          ? "Proposed workflow: “after changes — run/write the affected tests”. Saving it as a project rule would remind every coding run. Nothing changes until you accept it in the Memory Inbox."
          : null,
    },
    {
      id: "explanation-heavy",
      label: "You often ask for explanations",
      occurrences: explains,
      threshold: 10,
      proposal:
        explains >= 10 && total > 0
          ? "Proposed preference: answers default to “explain, then act”. Saving it as a preference memory would shape future answers. Nothing changes until you accept it."
          : null,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Usage touch (called by retrieval when memories are actually used)     */
/* ------------------------------------------------------------------ */

export async function touchMemoryUsage(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date();
  try {
    await db.memoryItem.updateMany({
      where: { id: { in: ids } },
      data: { useCount: { increment: 1 }, lastUsedAt: now },
    });
    // Event per item, but only when the item wasn't recorded in the last hour
    // (append-only without spam).
    const items = await db.memoryItem.findMany({
      where: { id: { in: ids }, lastUsedAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } },
      select: { id: true },
    });
    for (const item of items) {
      await db.memoryEvent.create({ data: { itemId: item.id, eventType: "recalled", detail: "used by an assistant run" } });
    }
  } catch (error) {
    logWarn("memory: usage touch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Stats for the Memory panel overview                                  */
/* ------------------------------------------------------------------ */

export interface MemoryStats {
  active: number;
  proposed: number;
  disabled: number;
  byLayer: Record<string, number>;
  glossaryEntries: number;
}

export async function getMemoryStats(): Promise<MemoryStats> {
  const rows = await db.memoryItem.findMany({
    where: { status: { in: ["active", "proposed", "disabled"] } },
    select: { status: true, type: true },
  });
  const byLayer: Record<string, number> = {};
  for (const row of rows) {
    if (row.status === "active") byLayer[row.type] = (byLayer[row.type] ?? 0) + 1;
  }
  const glossaryEntries = await db.glossaryEntry.count({ where: { status: "active" } });
  return {
    active: rows.filter((r) => r.status === "active").length,
    proposed: rows.filter((r) => r.status === "proposed").length,
    disabled: rows.filter((r) => r.status === "disabled").length,
    byLayer,
    glossaryEntries,
  };
}

/* Re-exports for the API layer. */
export { createMemoryItemSchema, MEMORY_STATUSES };
