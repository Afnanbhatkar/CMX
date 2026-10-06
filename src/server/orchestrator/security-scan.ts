/**
 * CodeMind X V2 — Security Agent static scanner (Phase 9 spec §4).
 *
 * Pattern-based static analysis over workspace text files: hardcoded
 * secrets, injection sinks, unsafe APIs, insecure transport. HONEST
 * LIMITS: this is a regex rule scan, not a full SAST/taint engine —
 * findings are candidate issues with exact locations, not proven
 * vulnerabilities. Read-only by construction.
 */

import { buildWorkspaceTree, isTextFile, readWorkspaceFile } from "@/lib/server/repository-fs";

export interface StaticFinding {
  ruleId: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  path: string;
  line: number;
  message: string;
  /** Short matched excerpt (trimmed, ≤120 chars). */
  excerpt: string;
}

interface ScanRule {
  id: string;
  severity: StaticFinding["severity"];
  pattern: RegExp;
  message: string;
  /** Skip lines that look like obvious non-secrets/tests. */
  skip?: (line: string) => boolean;
}

const RULES: ScanRule[] = [
  {
    id: "hardcoded-secret",
    severity: "critical",
    pattern:
      /\b(api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|password)\b\s*[:=]\s*["'][^"'\s]{8,}["']/i,
    message: "Possible hardcoded credential literal assigned to a secret-looking identifier.",
    skip: (line) =>
      /process\.env|import\.meta\.env|\$\{|placeholder|example|dummy|xxx|test[-_]?key|your[-_]?key/i.test(
        line,
      ),
  },
  {
    id: "eval-usage",
    severity: "high",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    message: "Dynamic code evaluation sink (eval / new Function) — injection risk if inputs are untrusted.",
  },
  {
    id: "shell-exec",
    severity: "high",
    pattern: /child_process|execSync\s*\(|exec\s*\(\s*[`"']/,
    message: "Shell execution surface — command injection risk if inputs are untrusted.",
  },
  {
    id: "sql-concat",
    severity: "high",
    pattern: /(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^;\n]*($\{|["']\s*\+|\+\s*["'])/i,
    message: "SQL built by string concatenation/interpolation — use parameterized queries.",
  },
  {
    id: "xss-html-sink",
    severity: "medium",
    pattern: /dangerouslySetInnerHTML|\.innerHTML\s*=/,
    message: "Raw HTML sink — sanitize content before it reaches the DOM.",
  },
  {
    id: "weak-hash",
    severity: "medium",
    pattern: /createHash\s*\(\s*["'](md5|sha1)["']\s*\)/,
    message: "Weak hash algorithm (md5/sha1) — not collision-resistant.",
  },
  {
    id: "cors-wildcard",
    severity: "medium",
    pattern: /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*/i,
    message: "Wildcard CORS origin — any site may read the response.",
  },
  {
    id: "insecure-transport",
    severity: "low",
    pattern: /["']http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/,
    message: "Plain-text HTTP endpoint (non-local) — prefer HTTPS.",
  },
  {
    id: "jwt-none",
    severity: "high",
    pattern: /algorithm[s]?\s*[:=]\s*\[?\s*["']none["']/i,
    message: 'JWT "none" algorithm allowed — signature bypass risk.',
  },
];

const MAX_FINDINGS_PER_FILE = 6;
const MAX_TOTAL_FINDINGS = 40;
const MAX_FILE_BYTES = 300_000;
/** Files that are pure fixtures for these rules (tests) get lower priority. */
function isLowPriorityPath(path: string): boolean {
  return /(^|\/)(test|tests|__tests__|fixtures?|examples?)\//i.test(path);
}

/** Scan the given paths (or the whole workspace tree) with the rule set. */
export async function runStaticSecurityScan(
  scopedPaths: string[] | null,
  signal?: AbortSignal,
): Promise<{ findings: StaticFinding[]; filesScanned: number }> {
  const paths =
    scopedPaths && scopedPaths.length > 0
      ? scopedPaths
      : await collectWorkspaceTextFiles();

  const findings: StaticFinding[] = [];
  let filesScanned = 0;

  const ordered = [
    ...paths.filter((p) => !isLowPriorityPath(p)),
    ...paths.filter((p) => isLowPriorityPath(p)),
  ];

  for (const path of ordered) {
    if (signal?.aborted) break;
    if (findings.length >= MAX_TOTAL_FINDINGS) break;
    if (!isTextFile(path)) continue;

    const result = await readWorkspaceFile(path);
    if (!result.ok) continue;
    if (result.file.content.length > MAX_FILE_BYTES) continue;
    filesScanned += 1;

    const lines = result.file.content.split("\n");
    let perFile = 0;
    for (let i = 0; i < lines.length && perFile < MAX_FINDINGS_PER_FILE; i += 1) {
      const line = lines[i];
      for (const rule of RULES) {
        if (rule.skip?.(line)) continue;
        if (rule.pattern.test(line)) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            path,
            line: i + 1,
            message: rule.message,
            excerpt: line.trim().slice(0, 120),
          });
          perFile += 1;
          break; // one rule per line is enough for a summary scan
        }
      }
      if (findings.length >= MAX_TOTAL_FINDINGS) break;
    }
  }

  return { findings, filesScanned };
}

async function collectWorkspaceTextFiles(): Promise<string[]> {
  const tree = await buildWorkspaceTree();
  const out: string[] = [];
  const walk = (nodes: typeof tree) => {
    for (const node of nodes) {
      if (node.type === "dir" && node.children) walk(node.children);
      else if (node.type === "file") out.push(node.path);
    }
  };
  walk(tree);
  return out.filter(isTextFile).slice(0, 400);
}
