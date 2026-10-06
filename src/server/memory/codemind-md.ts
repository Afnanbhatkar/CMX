/**
 * CodeMind X V2 — Phase 9.5: CODEMIND.md recognition (spec §5).
 *
 * A repository-visible `CODEMIND.md` holds USER-AUTHORED explicit project
 * conventions. The system must distinguish it from arbitrary README
 * content:
 *   - CODEMIND.md is the ONLY repository file whose lines may become
 *     explicit project-rule memories (source "explicit", origin
 *     "codemind-md"), because its contract is "rules the user wrote".
 *   - README.md is NEVER parsed by the memory engine. Its text is
 *     untrusted repository data (RULES.md §3) — an eval case proves that
 *     an injection-shaped README line can never become a memory.
 *
 * Parsing is line-based and honest: only bullet lines under the
 * `# CodeMind Project Rules` heading (or the whole file if no such heading
 * exists) become candidates; everything else is ignored.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();
export const CODEMIND_MD_PATH = "CODEMIND.md";
const MAX_FILE_BYTES = 100_000;

export interface ParsedCodemindRule {
  /** 1-based line number in CODEMIND.md — the real evidence anchor. */
  line: number;
  /** The rule text (bullet marker stripped, trimmed). */
  text: string;
  /** Real evidence ref: "CODEMIND.md#<line>". */
  evidenceRef: string;
}

export interface CodemindParseResult {
  exists: boolean;
  /** True when the standard "# CodeMind Project Rules" heading was found. */
  hasRulesHeading: boolean;
  rules: ParsedCodemindRule[];
}

/** Read + parse the workspace CODEMIND.md (never throws on missing file). */
export async function parseCodemindMd(): Promise<CodemindParseResult> {
  const full = path.join(REPO_ROOT, CODEMIND_MD_PATH);
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) {
    return { exists: false, hasRulesHeading: false, rules: [] };
  }
  const text = await readFile(full, "utf8");
  const capped = text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) : text;
  const lines = capped.split("\n");

  const headingIdx = lines.findIndex((l) =>
    /^#{1,3}\s*CodeMind Project Rules\s*$/i.test(l.trim()),
  );
  const bodyLines =
    headingIdx >= 0 ? lines.slice(headingIdx + 1) : lines;

  const rules: ParsedCodemindRule[] = [];
  for (let i = 0; i < bodyLines.length; i += 1) {
    const raw = bodyLines[i];
    const lineNo = (headingIdx >= 0 ? headingIdx + 1 : 0) + i + 1;
    if (/^#{1,3}\s/.test(raw.trim())) break; // next section → stop
    const bullet = /^[-*+]\s+(.{2,500})$/.exec(raw.trim());
    if (!bullet) continue;
    const text = bullet[1].trim();
    if (!text) continue;
    rules.push({
      line: lineNo,
      text,
      evidenceRef: `${CODEMIND_MD_PATH}#${lineNo}`,
    });
  }

  return { exists: true, hasRulesHeading: headingIdx >= 0, rules };
}

/**
 * Sync CODEMIND.md rules into explicit project-rule memories.
 * Idempotent: a rule whose content already exists as an active codemind-md
 * memory is skipped. Returns per-rule outcomes for honest UI.
 */
export interface CodemindSyncResult {
  created: number;
  skipped: number;
  items: { id: string; text: string; created: boolean }[];
}

export async function syncCodemindRules(
  createRule: (input: {
    title: string;
    content: string;
    evidenceRef: string;
  }) => Promise<{ id: string } | null>,
): Promise<CodemindSyncResult> {
  const parsed = await parseCodemindMd();
  const items: CodemindSyncResult["items"] = [];
  let created = 0;
  let skipped = 0;
  for (const rule of parsed.rules) {
    const result = await createRule({
      title: rule.text.slice(0, 120),
      content: rule.text,
      evidenceRef: rule.evidenceRef,
    });
    if (result) {
      created += 1;
      items.push({ id: result.id, text: rule.text, created: true });
    } else {
      skipped += 1;
      items.push({ id: "", text: rule.text, created: false });
    }
  }
  return { created, skipped, items };
}
