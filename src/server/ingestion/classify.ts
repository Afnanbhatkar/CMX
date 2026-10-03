import type { ContentClassification } from "./index-metadata";

/**
 * CodeMind X V2 — trust-oriented file classification (Phase 5, V2.1).
 *
 * SECURITY-ORIENTED, INFORMATIONAL ONLY. A classification is an observation
 * that helps the UI describe what a file probably is; it NEVER makes content
 * authoritative, never overrides user instructions, and is never treated as a
 * command or a security verdict by itself (RULES.md §3/§4/§9). `null` means
 * ordinary source code — unclassified and NOT flagged.
 *
 * Precedence (first match wins; later rules exclude files matched above):
 *   1. generated_output  — build/vendor/coverage output, minified maps, lockfiles
 *   2. fixture           — test fixtures, snapshots, mocks, testdata
 *   3. documentation     — docs formats + well-known repo meta filenames
 *   4. comment           — text whose head is ≥60% comment lines (never binary)
 *   5. data              — structured data formats
 *   6. null              — ordinary source code
 */

/* ------------------------------------------------------------------ */
/* Path helpers                                                        */
/* ------------------------------------------------------------------ */

function segmentsOf(relativePath: string): string[] {
  return relativePath.replace(/\\/g, "/").split("/").filter((s) => s.length > 0);
}

function basenameOf(relativePath: string): string {
  const segments = segmentsOf(relativePath);
  return segments[segments.length - 1] ?? relativePath;
}

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

/** Directory-segment match: "src/dist/x.js" matches, "adist/x.js" does not. */
function hasSegment(relativePath: string, segment: string): boolean {
  return segmentsOf(relativePath).includes(segment);
}

/* ------------------------------------------------------------------ */
/* Rule 1 — generated output                                           */
/* ------------------------------------------------------------------ */

const GENERATED_DIRS = new Set([
  "dist",
  "build",
  "coverage",
  "vendor",
  "output",
  "generated",
]);

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "cargo.lock",
  "poetry.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum",
]);

/** .DS_Store-type OS artifacts. */
const OS_ARTIFACT_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

function isGeneratedOutput(relativePath: string): boolean {
  const segments = segmentsOf(relativePath);
  if (segments.some((s) => GENERATED_DIRS.has(s.toLowerCase()))) return true;

  const name = basenameOf(relativePath);
  const lower = name.toLowerCase();
  if (LOCKFILE_NAMES.has(lower)) return true;
  if (OS_ARTIFACT_NAMES.has(lower)) return true;
  if (lower.endsWith(".min.js") || lower.endsWith(".min.css")) return true;
  if (lower.endsWith(".map") || lower.endsWith(".d.ts.map")) return true;
  if (lower.includes(".generated.")) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Rule 2 — fixtures                                                   */
/* ------------------------------------------------------------------ */

const FIXTURE_DIRS = new Set(["fixtures", "__fixtures__", "testdata", "__mocks__"]);

function isFixture(relativePath: string): boolean {
  const segments = segmentsOf(relativePath);
  if (segments.some((s) => FIXTURE_DIRS.has(s.toLowerCase()))) return true;
  const lower = basenameOf(relativePath).toLowerCase();
  return lower.endsWith(".snap") || lower.includes(".fixture.");
}

/* ------------------------------------------------------------------ */
/* Rule 3 — documentation                                              */
/* ------------------------------------------------------------------ */

const DOC_EXTS = new Set([".md", ".mdx", ".rst", ".txt", ".adoc", ".rtf"]);

/** Well-known repository meta filenames (prefix match, case-insensitive). */
const DOC_BASENAMES = [
  "license",
  "notice",
  "authors",
  "contributors",
  "changelog",
  "code_of_conduct",
  "contributing",
  "security",
  "readme",
] as const;

function isDocumentation(relativePath: string): boolean {
  const segments = segmentsOf(relativePath);
  if (segments[0]?.toLowerCase() === "docs") return true;

  const name = basenameOf(relativePath);
  const lower = name.toLowerCase();
  if (DOC_EXTS.has(extOf(name))) return true;
  return DOC_BASENAMES.some((prefix) => lower.startsWith(prefix));
}

/* ------------------------------------------------------------------ */
/* Rule 4 — comment-dominated text                                     */
/* ------------------------------------------------------------------ */

const COMMENT_TOKENS = ["//", "/*", "*", "#", "<!--", "--"] as const;

/**
 * True when ≥60% of the non-empty lines within the first ≤100 lines of
 * `headText` start with a comment token. NEVER applied to binary content.
 */
function isCommentDominated(headText: string): boolean {
  const lines = headText.split(/\r?\n/).slice(0, 100);
  let nonEmpty = 0;
  let comments = 0;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.length === 0) continue;
    nonEmpty += 1;
    if (COMMENT_TOKENS.some((token) => trimmed.startsWith(token))) comments += 1;
  }
  return nonEmpty > 0 && comments / nonEmpty >= 0.6;
}

/* ------------------------------------------------------------------ */
/* Rule 5 — structured data                                            */
/* ------------------------------------------------------------------ */

const DATA_EXTS = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".csv",
  ".tsv",
  ".toml",
  ".ini",
  ".env",
  ".properties",
  ".sql",
  ".graphql",
  ".proto",
]);

function isData(relativePath: string): boolean {
  const name = basenameOf(relativePath);
  if (name === ".env" || name.toLowerCase().startsWith(".env.")) return true;
  return DATA_EXTS.has(extOf(name));
}

/* ------------------------------------------------------------------ */
/* Public classifier                                                   */
/* ------------------------------------------------------------------ */

export interface ClassifyOptions {
  /** Content is binary (by extension or NUL sniff) — comment rule disabled. */
  isBinary?: boolean;
  /**
   * First ≤8 KB of the file decoded as utf8, when available. Null/absent for
   * binary files, oversized files, and unreadable files (honest absence —
   * the comment rule then simply cannot fire).
   */
  headText?: string | null;
}

/**
 * Classify a repository-relative path (with optional content head) into the
 * V2.1 trust vocabulary, or null for ordinary source code. INFORMATIONAL
 * ONLY — the result never makes content authoritative (see module doc).
 */
export function classifyFile(
  relativePath: string,
  opts?: ClassifyOptions,
): ContentClassification | null {
  if (typeof relativePath !== "string" || relativePath.length === 0) return null;

  // 1. generated output (build/vendor output, minified/maps, lockfiles, OS artifacts)
  if (isGeneratedOutput(relativePath)) return "repository_generated_output";

  // 2. fixtures (test data, snapshots, mocks)
  if (isFixture(relativePath)) return "repository_fixture";

  // 3. documentation (doc formats, docs/ trees, well-known meta filenames)
  if (isDocumentation(relativePath)) return "repository_documentation";

  // 4. comment-dominated text — needs a real text head; never for binary.
  const headText = opts?.headText;
  if (!opts?.isBinary && typeof headText === "string" && headText.length > 0) {
    if (isCommentDominated(headText)) return "repository_comment";
  }

  // 5. structured data formats (only when nothing above matched)
  if (isData(relativePath)) return "repository_data";

  // 6. ordinary source code — unclassified, NOT flagged.
  return null;
}
