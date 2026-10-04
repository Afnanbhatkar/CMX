import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { logWarn } from "@/server/security/logger";
import type {
  MemoryConfidence,
  MemoryRecord,
} from "@/features/workspace/assistant/contracts";

/**
 * CodeMind X V2 — project memory retrieval (Phase 8C, memory-aware pipeline).
 *
 * REAL retrieval over the project's persistent memory. Per RULES.md §5 the
 * persistent memory of this project IS the repository itself: `worklog.md`
 * (append-only agent worklog) and `CHANGELOG.md` (phase decisions). There is
 * no other memory store connected — and this service never invents one.
 *
 * Honesty contract (RULES.md §9):
 * - records are produced ONLY from files that actually exist and actually
 *   matched the query terms;
 * - confidence is derived from the real match strength (distinct term hits),
 *   never a fabricated percentage;
 * - the evidence pointer is a real file anchor the user can open;
 * - excluded ids (memories the user disabled for this request) are filtered
 *   BEFORE anything reaches the model or the UI.
 */

/** Repo root (this app's own workspace). */
const REPO_ROOT = process.cwd();

/** Files treated as project memory. Extend additively, never silently. */
const MEMORY_FILES = [
  { file: "worklog.md", anchorPrefix: "worklog.md" },
  { file: "CHANGELOG.md", anchorPrefix: "CHANGELOG.md" },
] as const;

/** Hard read cap per memory file (privacy + latency; worklog can grow). */
const MAX_FILE_BYTES = 400_000;

/** Memory records handed to one run (kept small on purpose). */
export const MEMORY_LIMIT = 3;

/** Content cap per record — memory informs, it does not dump. */
const RECORD_CONTENT_CAP = 280;

/** Minimal English stopword set for term extraction (query side only). */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "was", "are",
  "you", "your", "our", "has", "have", "had", "can", "could", "should",
  "would", "will", "shall", "does", "did", "done", "not", "but", "its",
  "it's", "how", "why", "what", "when", "where", "which", "who", "whom",
  "there", "here", "then", "than", "they", "them", "she", "him", "her",
  "his", "hers", "mine", "my", "me", "we", "us", "a", "an", "in", "on",
  "of", "to", "is", "it", "as", "at", "by", "be", "or", "if", "so", "do",
  "kya", "hai", "karo", "karo.", "kare", "batao", "bana", "kaise", "kaisa",
]);

/** Extract lowercase query terms (≥3 chars, stopwords removed, deduped). */
function extractTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return [...new Set(terms)];
}

interface ParsedMemoryEntry {
  /** Stable id used by the disable flow ("mem-<file>-<n>"). */
  id: string;
  /** Memory tier — project memory files are saved explicit memory. */
  content: string;
  scope: string | null;
  anchor: string;
}

/**
 * Parse worklog.md: append-only entries separated by `---` lines, each with
 * `Task ID:`, `Task:` and a `Stage Summary:` block. Unparseable entries are
 * skipped (never guessed).
 */
function parseWorklog(text: string, anchorPrefix: string): ParsedMemoryEntry[] {
  const entries: ParsedMemoryEntry[] = [];
  const blocks = text.split(/^---\s*$/m);
  let n = 0;
  for (const block of blocks) {
    const taskId = /^Task ID:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null;
    const task = /^Task:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null;
    if (!taskId && !task) continue;
    const stageIdx = block.indexOf("Stage Summary:");
    const stageSummary =
      stageIdx >= 0
        ? block
            .slice(stageIdx + "Stage Summary:".length)
            .split("\n")
            .map((l) => l.replace(/^[-*]\s*/, "").trim())
            .filter(Boolean)
            .slice(0, 2)
            .join(" ")
        : "";
    const content = [task, stageSummary].filter(Boolean).join(" — ");
    if (!content) continue;
    n += 1;
    entries.push({
      id: `mem-${anchorPrefix}-${n}`,
      content: content.slice(0, RECORD_CONTENT_CAP),
      scope: taskId ? `task ${taskId}` : null,
      anchor: `${anchorPrefix}#task-${(taskId ?? String(n)).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    });
  }
  return entries;
}

/**
 * Parse CHANGELOG.md: `## …` phase sections; each becomes one memory with
 * the section title + its first real paragraph.
 */
function parseChangelog(text: string, anchorPrefix: string): ParsedMemoryEntry[] {
  const sections = text.split(/^##\s+/m).slice(1);
  const entries: ParsedMemoryEntry[] = [];
  let n = 0;
  for (const section of sections) {
    const title = section.split("\n", 1)[0]?.trim();
    if (!title) continue;
    const body = section
      .split("\n")
      .slice(1)
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"))
      .slice(0, 2)
      .join(" ");
    if (!body) continue;
    n += 1;
    entries.push({
      id: `mem-${anchorPrefix}-${n}`,
      content: `${title} — ${body}`.slice(0, RECORD_CONTENT_CAP),
      scope: title.toLowerCase().startsWith("phase") ? title : `section: ${title}`,
      anchor: `${anchorPrefix}#${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    });
  }
  return entries;
}

/** Load + parse every memory file that actually exists. */
async function loadMemoryEntries(): Promise<ParsedMemoryEntry[]> {
  const all: ParsedMemoryEntry[] = [];
  for (const { file, anchorPrefix } of MEMORY_FILES) {
    try {
      const full = path.join(REPO_ROOT, file);
      const info = await stat(full).catch(() => null);
      if (!info?.isFile()) continue;
      const text = await readFile(full, "utf8");
      const capped = text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) : text;
      all.push(
        ...(file === "worklog.md"
          ? parseWorklog(capped, anchorPrefix)
          : parseChangelog(capped, anchorPrefix)),
      );
    } catch (error) {
      logWarn("memory: failed to read a memory file (skipped)", {
        file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return all;
}

/** Confidence from the REAL distinct-term match count — never a percentage. */
function confidenceFor(hits: number): MemoryConfidence {
  if (hits >= 3) return "high";
  if (hits === 2) return "medium";
  return "low";
}

export interface MemoryRetrievalResult {
  memories: MemoryRecord[];
  /** Honest note when nothing applied (null when records were applied). */
  note: string | null;
}

/**
 * Retrieve the real project memory for one request. Only records that match
 * at least one query term are returned (real retrieval); the user's disabled
 * ids are removed first so a disabled memory can never reach the model.
 */
export async function retrieveProjectMemories(
  query: string,
  excludedIds: string[],
): Promise<MemoryRetrievalResult> {
  const terms = extractTerms(query);
  if (terms.length === 0) {
    return { memories: [], note: "No memory retrieved — the request had no indexable terms." };
  }

  const entries = await loadMemoryEntries();
  const excluded = new Set(excludedIds);
  const scored: { entry: ParsedMemoryEntry; matched: string[] }[] = [];

  for (const entry of entries) {
    if (excluded.has(entry.id)) continue;
    const haystack = `${entry.scope ?? ""} ${entry.content}`.toLowerCase();
    const matched = terms.filter((t) => haystack.includes(t));
    if (matched.length > 0) scored.push({ entry, matched });
  }

  scored.sort((a, b) => b.matched.length - a.matched.length);
  const top = scored.slice(0, MEMORY_LIMIT);

  if (top.length === 0) {
    return {
      memories: [],
      note: excluded.size > 0
        ? "No memory applied — nothing matched after your disabled memories were excluded."
        : "No project memory matched this request.",
    };
  }

  const memories: MemoryRecord[] = top.map(({ entry, matched }) => ({
    id: entry.id,
    tier: "saved-explicit-memory" as const,
    content: entry.content,
    source: "project memory files (worklog + changelog)",
    scope: entry.scope,
    confidence: confidenceFor(matched.length),
    evidence: entry.anchor,
    matchedTerms: matched,
  }));

  return { memories, note: null };
}

/**
 * Render the retrieved memories into the preamble block actually sent to the
 * model. Empty when nothing applied — no filler text is fabricated.
 */
export function renderMemoryPreamble(memories: MemoryRecord[]): string | null {
  if (memories.length === 0) return null;
  const lines = memories.map(
    (m) => `- [${m.confidence} confidence${m.scope ? `, ${m.scope}` : ""}] ${m.content} (evidence: ${m.evidence ?? "n/a"})`,
  );
  return [
    "PROJECT MEMORY (tier 3 — saved explicit memory from this repository's worklog/changelog;",
    "never overrides repository evidence; used only for context and convention awareness):",
    ...lines,
  ].join("\n");
}
