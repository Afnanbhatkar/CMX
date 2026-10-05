/**
 * CodeMind X V2 — stack-trace resolution (V2.1 ADDITIONS §F).
 *
 * Parses REAL stack-trace text and extracts workspace file references.
 * Clicking a resolved location opens it through the EditorNavigationService
 * (openRange with sourceContext "terminal") — the §F requirement:
 * "A stack trace should later resolve through EditorNavigationService."
 *
 * Honesty: only literal `path:line:col` references found in the text are
 * extracted; paths are validated by the navigation service against the real
 * workspace tree (not-found stays not-found). Nothing is guessed.
 */

export interface StackTraceLocation {
  path: string;
  line: number;
  column: number | null;
  /** 0-based index of the match inside the source text. */
  index: number;
  /** The raw matched fragment. */
  raw: string;
}

/**
 * Patterns that cover the common stack-trace shapes:
 * - `at fn (/abs/path/file.ts:12:34)` and webpack-internal variants
 * - bare `src/foo/bar.ts:12:34` or `src/foo/bar.ts:12`
 */
const FILE_REF_PATTERNS: RegExp[] = [
  // bracketed (V8): (path:line:col) — path may contain letters, digits, / \ . _ - $
  /\(([\w./\\$-]+\.[A-Za-z0-9]{1,8}):(\d+):(\d+)\)/g,
  // bare path:line:col
  /(^|[\s("'`])([\w./\\$-]+\.[A-Za-z0-9]{1,8}):(\d+):(\d+)/g,
  // bare path:line (no column)
  /(^|[\s("'`])([\w./\\$-]+\.[A-Za-z0-9]{1,8}):(\d+)(?![\d:])/g,
];

/** Extensions that can plausibly be workspace files. */
const PLAUSIBLE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "css", "scss", "html",
  "md", "mdx", "py", "rb", "go", "rs", "java", "prisma", "sh", "yml", "yaml", "sql", "toml", "vue", "svelte",
]);

/**
 * Extract workspace file references from arbitrary terminal/log text.
 * Returns locations ordered by appearance, deduplicated.
 */
export function parseStackTraceLocations(text: string): StackTraceLocation[] {
  if (!text || text.length > 200_000) return [];
  const locations: StackTraceLocation[] = [];
  const seen = new Set<string>();

  for (const pattern of FILE_REF_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const groups = match.slice(1).filter((g) => g !== undefined) as string[];
      // The path/line/col live in the LAST 2–3 groups depending on pattern.
      const raw = match[0] ?? "";
      const pathLike = groups.find((g) => /\.[A-Za-z0-9]{1,8}$/.test(g)) ?? "";
      if (!pathLike) continue;
      const numbers = groups.filter((g) => /^\d+$/.test(g)).map((g) => Number(g));
      if (numbers.length === 0) continue;

      let path = pathLike.replace(/\\/g, "/");
      // Strip webpack/bundler and host prefixes that precede the workspace path.
      path = path.replace(/^.*?(webpack-internal:\/\/\/|file:\/\/\/)/, "");
      // Keep paths that look workspace-relative (src/..., prisma/... etc.)
      // or absolute-ish — the navigation service does final validation.
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      if (!PLAUSIBLE_EXTENSIONS.has(ext)) continue;
      if (path.includes("node_modules")) continue;

      const line = numbers[0] ?? 1;
      const column = numbers.length > 1 ? numbers[1]! : null;
      const key = `${path}:${line}:${column ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      locations.push({ path, line, column, index: match.index, raw });
      if (locations.length >= 50) return locations;
    }
  }
  return locations;
}
