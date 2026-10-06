/**
 * CodeMind X V2 — Phase 9.5: run-time memory retrieval.
 *
 * Merges the two real memory stores for ONE assistant/orchestrator run:
 *   1. the DB memory items (Phase 9.5 Adaptive Memory Engine), and
 *   2. the Phase 8C project memory files (worklog.md + CHANGELOG.md).
 *
 * Ordering IS the precedence contract (spec §4) — memory never overrides
 * repository evidence:
 *   tier 3 (saved explicit memory): explicit DB items first (newest-first),
 *          then the worklog/changelog project memories;
 *   tier 4 (inferred memory):       ACTIVE inferred DB items only.
 * Proposed (in-box) and disabled/expired/superseded items are NEVER
 * returned. The user's disabled-for-this-request ids are removed BEFORE
 * anything reaches the model or the chip.
 *
 * Incognito (spec §13): when the run set incognitoMemoryReads, only the
 * project memory files can be read (or nothing, if the user also disables
 * those via excluded ids) — no DB memory joins the prompt. Reads that are
 * skipped are reported honestly in the note.
 */

import { db } from "@/lib/db";
import { logWarn } from "@/server/security/logger";
import type { MemoryRecord } from "@/features/workspace/assistant/contracts";

import { retrieveProjectMemories } from "@/server/services/memory-service";
import { touchMemoryUsage } from "./engine";
import {
  confidenceFromScore,
  parseEvidenceRefs,
  type MemoryPreferences,
} from "./types";

export interface RunMemoryPolicy {
  /** Spec §13 — incognito disables NEW persistent memory (writes). */
  incognito: boolean;
  /** Spec §13 — memory reads can be disabled independently by the user. */
  readsDisabled: boolean;
  /** Adaptive depth for this run (one-click overridable, spec §9). */
  depth: MemoryPreferences["depth"];
}

export interface RunMemoryRetrieval {
  memories: MemoryRecord[];
  note: string | null;
  /** The policy actually applied (echoed for observability). */
  appliedPolicy: RunMemoryPolicy;
  /** DB item ids that were actually handed to the run (for usage touch). */
  usedDbIds: string[];
}

const DB_ITEM_LIMIT = 6;

function scopeLabel(scope: string, scopeRef: string | null): string {
  switch (scope) {
    case "user":
      return "user";
    case "repository":
      return scopeRef ? `repository ${scopeRef.slice(0, 12)}` : "repository (this workspace)";
    case "path":
      return `path ${scopeRef ?? ""}`;
    case "language":
      return `language ${scopeRef ?? ""}`;
    case "team":
      return scopeRef ? `team/repository ${scopeRef.slice(0, 12)}` : "team";
    default:
      return scope;
  }
}

export async function retrieveRunMemories(
  query: string,
  excludedIds: string[],
  policy: RunMemoryPolicy,
): Promise<RunMemoryRetrieval> {
  const excluded = new Set(excludedIds);
  const memories: MemoryRecord[] = [];
  const usedDbIds: string[] = [];

  if (policy.readsDisabled) {
    const note =
      policy.incognito
        ? "Incognito run — memory reads are disabled by your setting; nothing from memory informed this response."
        : "Memory reads are disabled for this run; nothing from memory informed this response.";
    return { memories: [], note, appliedPolicy: policy, usedDbIds: [] };
  }

  // ---- DB items: explicit actives first (tier 3), then inferred actives ----
  try {
    const actives = await db.memoryItem.findMany({
      where: { status: "active" },
      orderBy: { updatedAt: "desc" },
      take: 120,
    });
    const now = Date.now();
    const eligible = actives.filter((row) => {
      if (row.expiresAt && row.expiresAt.getTime() < now) return false;
      if (excluded.has(row.id)) return false;
      return true;
    });
    const explicit = eligible.filter((r) => r.source === "explicit");
    const inferred = eligible.filter((r) => r.source === "inferred");
    const ordered = [...explicit, ...inferred].slice(0, DB_ITEM_LIMIT);

    for (const row of ordered) {
      const scopeTxt = scopeLabel(row.scope, row.scopeRef);
      memories.push({
        id: row.id,
        tier: row.source === "explicit" ? "saved-explicit-memory" : "inferred-memory",
        content: row.content.slice(0, 280),
        source:
          row.source === "explicit"
            ? `saved ${row.type.replace("-", " ")} (${row.origin === "codemind-md" ? "CODEMIND.md" : "user-saved memory"})`
            : `inferred ${row.type.replace("-", " ")} (accepted via Memory Inbox)`,
        scope: scopeTxt,
        confidence: confidenceFromScore(row.confidence),
        evidence: parseEvidenceRefs(row.evidenceRefsJson)[0] ?? null,
        matchedTerms: [],
      });
      usedDbIds.push(row.id);
    }
  } catch (error) {
    logWarn("memory: db retrieval failed (continuing with project files only)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ---- Project memory files (Phase 8C): tier 3 companion store ----
  const remaining = Math.max(0, 3 - memories.length);
  if (remaining > 0) {
    const project = await retrieveProjectMemories(query, [...excluded]);
    for (const record of project.memories.slice(0, remaining)) {
      memories.push(record);
    }
  }

  let note: string | null = null;
  if (memories.length === 0) {
    note = policy.incognito
      ? "Incognito run — no memory was applied (reads allowed but nothing matched)."
      : "No memory matched this request.";
  } else if (policy.incognito) {
    note = `Incognito run — ${memories.length} memory item(s) were read-only; nothing new will be saved.`;
  }

  // Usage bookkeeping: only for items actually handed to the run.
  if (usedDbIds.length > 0) {
    await touchMemoryUsage(usedDbIds);
  }

  return { memories, note, appliedPolicy: policy, usedDbIds };
}
