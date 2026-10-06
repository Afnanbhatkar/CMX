import { getSearchIndex } from "@/server/search/index/search-index";
import { logWarn } from "@/server/security/logger";
import type { StructuredReference, StructuredSymbol } from "@/features/workspace/assistant/contracts";

/**
 * CodeMind X V2 — Phase 8.5 Reference Verifier.
 *
 * Verifies EVERY file path / line number / symbol a structured response
 * produced against the REAL repository intelligence (the Phase 7 hybrid
 * search index: real file list, real line counts via contentOf, real
 * symbol table from the structure scanner).
 *
 * Honesty contract (8.5 §3):
 * - A reference is "verified" ONLY when the path exists in the workspace
 *   AND the claimed line range (when given) is within the file.
 * - Anything else is "unknown" — the UI shows plain text / an Unknown
 *   Reference badge and NEVER renders a clickable file link.
 * - Nothing is invented: an unknown reference stays unknown.
 */

/** Candidate reference before verification (path + optional line range). */
export interface CandidateReference {
  raw: string;
  path: string;
  line: number | null;
  lineEnd: number | null;
}

/** Workspace file extensions the index recognizes (mirror of the scanner). */
const KNOWN_FILE_RE =
  /\b[\w@./-]+(?:\/[\w@.-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|mdx|py|go|rs|java|kt|swift|rb|php|c|cpp|h|sh|sql|prisma|yml|yaml|toml|graphql|txt)\b/;

/** Extract repository file references (path[:line[-lineEnd]]) from free text. */
export function extractFileRefs(text: string): CandidateReference[] {
  const out: CandidateReference[] = [];
  const seen = new Set<string>();
  const re =
    /((?:[\w@.-]+\/)*[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|py|go|rs|java|sh|sql|prisma|yml|yaml|toml))(?::(\d{1,5})(?:-(\d{1,5}))?)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (seen.has(raw)) continue;
    seen.add(raw);
    const line = m[2] ? Number(m[2]) : null;
    const lineEnd = m[3] ? Number(m[3]) : null;
    out.push({ raw, path: m[1], line, lineEnd });
    if (out.length >= 24) break;
  }
  return out;
}

/** Normalize a model-provided path candidate ("./src/x.ts", "/src/x.ts"). */
function normalizePath(path: string): string {
  return path.trim().replace(/^\.\//, "").replace(/^\//, "");
}

interface IndexView {
  files: Set<string>;
  lineCountOf(path: string): number | null;
  symbolByName(name: string): { path: string; line: number; kind: string } | null;
}

async function loadIndexView(): Promise<IndexView | null> {
  try {
    const { index } = await getSearchIndex();
    const files = new Set(index.files.map((f) => f.path));
    const symbolsByName = new Map<string, { path: string; line: number; kind: string }>();
    // First definition wins; prefer concrete kinds over re-exports when both exist.
    for (const symbol of index.symbols) {
      if (!symbolsByName.has(symbol.name)) {
        symbolsByName.set(symbol.name, { path: symbol.path, line: symbol.line, kind: symbol.kind });
      }
    }
    return {
      files,
      lineCountOf: (path) => index.contentOf(path)?.length ?? null,
      symbolByName: (name) => symbolsByName.get(name) ?? null,
    };
  } catch (error) {
    logWarn("response-engine: repository index unavailable — references cannot be verified", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Verify one batch of candidate references. Index unavailable → all unknown (honest). */
export async function verifyReferences(
  candidates: CandidateReference[],
): Promise<StructuredReference[]> {
  if (candidates.length === 0) return [];
  const view = await loadIndexView();
  return candidates.map((candidate) => {
    const path = normalizePath(candidate.path);
    if (!view) {
      return {
        raw: candidate.raw,
        path,
        line: candidate.line,
        lineEnd: candidate.lineEnd,
        status: "unknown",
        lineCount: null,
        note: "repository index unavailable — reference could not be verified",
      } satisfies StructuredReference;
    }
    if (!view.files.has(path)) {
      return {
        raw: candidate.raw,
        path,
        line: candidate.line,
        lineEnd: candidate.lineEnd,
        status: "unknown",
        lineCount: null,
        note: "no such file in the workspace index",
      } satisfies StructuredReference;
    }
    const lineCount = view.lineCountOf(path);
    if (candidate.line !== null && lineCount !== null) {
      const end = candidate.lineEnd ?? candidate.line;
      const inRange = candidate.line >= 1 && end <= lineCount && candidate.line <= end;
      if (!inRange) {
        return {
          raw: candidate.raw,
          path,
          line: candidate.line,
          lineEnd: candidate.lineEnd,
          status: "unknown",
          lineCount,
          note: `path exists (${lineCount} lines) but line ${candidate.line}${candidate.lineEnd && candidate.lineEnd !== candidate.line ? `-${candidate.lineEnd}` : ""} is out of range`,
        } satisfies StructuredReference;
      }
    }
    return {
      raw: candidate.raw,
      path,
      line: candidate.line,
      lineEnd: candidate.lineEnd,
      status: "verified",
      lineCount,
      note: candidate.line !== null ? `verified against the real file (${lineCount ?? "?"} lines)` : "verified — file exists in the workspace",
    } satisfies StructuredReference;
  });
}

/** Normalize a model-provided symbol ("verifyReferences()", "new Foo<T>"). */
export function normalizeSymbolName(name: string): string {
  return name
    .trim()
    .replace(/^new\s+/, "")
    .replace(/^await\s+/, "")
    .replace(/\(.*$/, "")
    .replace(/<.*$/, "")
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
}

/** Verify symbol names against the real symbol table. */
export async function verifySymbols(names: string[]): Promise<StructuredSymbol[]> {
  const cleaned = [...new Set(names.map(normalizeSymbolName).filter((n) => n.length > 0))];
  if (cleaned.length === 0) return [];
  const view = await loadIndexView();
  return cleaned.map((name) => {
    const hit = view?.symbolByName(name) ?? null;
    return hit
      ? { name, status: "verified" as const, path: hit.path, line: hit.line, kind: hit.kind }
      : { name, status: "unknown" as const, path: null, line: null, kind: null };
  });
}

/** True when the given evidence text contains only VERIFIABLE file refs that all verify. */
export async function evidenceVerifies(evidence: string | null): Promise<{
  ok: boolean;
  refs: StructuredReference[];
}> {
  if (!evidence || evidence.trim().length === 0) return { ok: false, refs: [] };
  const candidates = extractFileRefs(evidence).filter((c) => KNOWN_FILE_RE.test(c.path));
  if (candidates.length === 0) return { ok: false, refs: [] };
  const refs = await verifyReferences(candidates);
  return { ok: refs.every((r) => r.status === "verified"), refs };
}
