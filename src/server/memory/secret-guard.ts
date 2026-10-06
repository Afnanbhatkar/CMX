/**
 * CodeMind X V2 — Phase 9.5 memory security guard (spec §15).
 *
 * Two hard rules, both enforced HERE before any DB write:
 *
 * 1. NEVER create memory from README instructions, code comments, source
 *    text, tool output, logs or commit messages. This is enforced BY
 *    CONSTRUCTION: the only call sites that create MemoryItems pass an
 *    allow-listed origin ("manual" | "user-message" | "codemind-md" |
 *    "inbox-accept") — `assertMemoryOriginAllowed` rejects everything else,
 *    and there is no code path that feeds repository/tool text into the
 *    creation APIs. The origin is stored on the row for auditability.
 *
 * 2. NEVER store secrets, credentials, tokens or private keys. Every
 *    candidate content/title passes `assertNoSecrets` — a pattern scanner
 *    over high-entropy assignment shapes, key formats and PEM blocks.
 *    False negatives are possible (this is not an oracle) — the guard is
 *    defense-in-depth behind the user-authored-only rule, and it is honest
 *    about that in its error text.
 */

import { ApiError } from "@/server/api/envelope";

import type { MemoryOrigin } from "./types";

/** Origins that may create a memory row — the complete, closed list. */
const ALLOWED_ORIGINS: readonly MemoryOrigin[] = [
  "manual",
  "user-message",
  "codemind-md",
  "inbox-accept",
] as const;

/**
 * Origins that may never create memory because they are repository- or
 * machine-derived text (spec §15). Listed for documentation + evals; the
 * allow-list above already rejects them structurally.
 */
export const FORBIDDEN_MEMORY_ORIGINS = [
  "readme",
  "source-comment",
  "source-text",
  "tool-output",
  "logs",
  "commit-message",
] as const;

export function assertMemoryOriginAllowed(origin: string): asserts origin is MemoryOrigin {
  if (!(ALLOWED_ORIGINS as readonly string[]).includes(origin)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Memory origin "${origin}" is not allowed. Memory can only be created from user-authored content (manual entry, user message, CODEMIND.md, inbox accept) — never from README/comment/tool output/log/commit text.`,
      422,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Secret pattern scanner                                               */
/* ------------------------------------------------------------------ */

interface SecretRule {
  id: string;
  pattern: RegExp;
  label: string;
}

const SECRET_RULES: SecretRule[] = [
  { id: "pem-private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "private key block" },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/, label: "AWS access key id" },
  { id: "github-pat", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, label: "GitHub token" },
  { id: "openai-style-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/, label: "API key (sk-…)" },
  { id: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, label: "Slack token" },
  { id: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/, label: "Google API key" },
  { id: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, label: "JWT" },
  { id: "bearer-scheme", pattern: /\bBearer\s+[A-Za-z0-9._-]{25,}\b/i, label: "bearer token" },
  {
    id: "credential-assignment",
    pattern:
      /\b(password|passwd|secret|api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|private[-_]?key)\b\s*[:=]\s*["'`]?[^"'`\s]{8,}/i,
    label: "credential-looking assignment",
  },
  {
    id: "connection-string",
    pattern:
      /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s"'`]*:[^\s"'`@]+@[^\s"'`]+/i,
    label: "connection string with credentials",
  },
];

export interface SecretScanResult {
  clean: boolean;
  findings: { ruleId: string; label: string }[];
}

/** Scan candidate memory text for secret-shaped content. */
export function scanForSecrets(text: string): SecretScanResult {
  const findings: SecretScanResult["findings"] = [];
  for (const rule of SECRET_RULES) {
    if (rule.pattern.test(text)) {
      findings.push({ ruleId: rule.id, label: rule.label });
    }
  }
  return { clean: findings.length === 0, findings };
}

/**
 * Guard a memory candidate (title + content) before any write.
 * Throws a 422 ApiError listing the matched rule ids — the user sees WHY
 * the memory was refused, the secrets themselves are never echoed back.
 */
export function assertNoSecrets(title: string, content: string): void {
  const combined = `${title}\n${content}`;
  const scan = scanForSecrets(combined);
  if (!scan.clean) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Memory refused by the Phase 9.5 security rule — content looks like it contains a ${scan.findings
        .map((f) => f.label)
        .join(", ")}. Secrets, credentials, tokens and private keys are never stored in memory (spec §15).`,
      422,
    );
  }
}
