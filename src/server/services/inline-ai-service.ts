/**
 * CodeMind X V2 — Inline AI service (Phase 8.75).
 *
 * Connects the LLM Gateway to the editor surfaces:
 * - inline code completion (ghost text, Tab / word-by-word accept),
 * - Cmd/Ctrl+K inline edit proposals (SHADOW BUFFER: the client renders the
 *   proposal and only an explicit Accept writes to the IN-MEMORY Monaco
 *   model — this build has no disk-write path at all, so nothing is ever
 *   silently persisted),
 * - Hinglish symbol explanation for the code-intelligence hover.
 *
 * All three calls go through LLMGateway.complete (the only provider seam,
 * Phase 8A §6) and report MEASURED gateway latency. Nothing is fabricated;
 * a model failure is an honest error, never a synthetic completion.
 *
 * Cancellation honesty: the z.ai transport exposes no request signal, so a
 * cancelled request cannot be aborted mid-flight server-side. The client
 * aborts the HTTP request and enforces a strict stale-guard (buffer version
 * + prefix check) BEFORE any result can be shown — an obsolete completion is
 * discarded, never inserted (Phase 8.75 §2).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { LLMGateway, LLMGatewayError } from "@/server/llm/llm-gateway";
import { logError } from "@/server/security/logger";

export class InlineAIError extends Error {
  constructor(
    public code: "failed" | "empty" | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "InlineAIError";
  }
}

export interface InlineAIResult {
  text: string;
  servedModel: string | null;
  /** MEASURED latency of the gateway call itself (ms). */
  gatewayLatencyMs: number;
}

/* ------------------------------------------------------------------ */
/* Project rules context (real file, excerpt — never fabricated)        */
/* ------------------------------------------------------------------ */

let rulesExcerpt: string | null | undefined;

/** Real excerpt of RULES.md from the repo root (null when unavailable). */
async function getProjectRulesExcerpt(): Promise<string | null> {
  if (rulesExcerpt !== undefined) return rulesExcerpt;
  try {
    const raw = await readFile(path.join(process.cwd(), "RULES.md"), "utf8");
    rulesExcerpt = raw.length > 1200 ? `${raw.slice(0, 1200)}…` : raw;
  } catch {
    rulesExcerpt = null;
  }
  return rulesExcerpt;
}

/* ------------------------------------------------------------------ */
/* Response post-processing (defensive against chat-model artifacts)    */
/* ------------------------------------------------------------------ */

/** Strip markdown fences a chat model may wrap code in. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[a-zA-Z0-9]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return (fence ? fence[1]! : trimmed).trim();
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

function lastNonEmptyLine(text: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trimEnd();
    if (line.trim().length > 0) return line;
  }
  return "";
}

/** Clean a completion: fences off, no duplicated prefix line, line cap. */
function normalizeCompletion(raw: string, prefix: string): string {
  let text = stripFences(raw);
  const prefixTail = lastNonEmptyLine(prefix);
  if (prefixTail && firstLine(text).trimEnd() === prefixTail.trimEnd()) {
    text = text.split("\n").slice(1).join("\n");
  }
  const lines = text.replace(/\t/g, "\t").split("\n");
  if (lines.length > 12) text = lines.slice(0, 12).join("\n");
  return text.trimEnd();
}

function throwGatewayError(error: unknown, what: string): never {
  if (error instanceof LLMGatewayError) {
    throw new InlineAIError(
      error.code === "timeout" ? "timeout" : error.code === "empty" ? "empty" : "failed",
      error.message,
    );
  }
  logError("inline-ai-service: request failed", {
    what,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
  throw new InlineAIError("failed", "The model gateway request failed.");
}

/* ------------------------------------------------------------------ */
/* 1. Inline completion                                                 */
/* ------------------------------------------------------------------ */

export interface InlineCompleteInput {
  path: string;
  language: string;
  /** Code before the cursor (client-trimmed budget). */
  prefix: string;
  /** Code after the cursor (client-trimmed budget). */
  suffix: string;
  nearbySymbols: string[];
  openTabs: string[];
  recentEdits: string[];
  selection: string | null;
}

export async function inlineComplete(input: InlineCompleteInput): Promise<InlineAIResult> {
  const rules = await getProjectRulesExcerpt();
  const blocks: string[] = [`File: ${input.path} (${input.language})`];
  if (rules) blocks.push(`[Project rules — excerpt]\n${rules}`);
  if (input.openTabs.length > 0) {
    blocks.push(`[Other open tabs]\n${input.openTabs.join("\n")}`);
  }
  if (input.nearbySymbols.length > 0) {
    blocks.push(`[Nearby symbols]\n${input.nearbySymbols.join("\n")}`);
  }
  if (input.recentEdits.length > 0) {
    blocks.push(`[Recent edits in this session]\n${input.recentEdits.join("\n")}`);
  }
  if (input.selection && input.selection.trim()) {
    blocks.push(`[User selection]\n${input.selection}`);
  }
  blocks.push(
    `[Code before cursor]\n${input.prefix}<CURSOR>${input.suffix ? `\n[Code after cursor]\n${input.suffix}` : ""}`,
  );

  try {
    const result = await LLMGateway.complete({
      messages: [
        {
          role: "assistant",
          content:
            "You are a code completion engine inside a code editor. Continue the code at <CURSOR>. " +
            "Reply with ONLY the raw code to insert — no explanations, no markdown fences, no repeating " +
            "the text before the cursor. Finish the current statement or block: usually 1-4 lines, never " +
            "more than 8. Match the file's indentation and style exactly. If nothing useful can be " +
            "inserted, reply with nothing.",
        },
        { role: "user", content: blocks.join("\n\n") },
      ],
      thinking: { type: "disabled" },
    });
    const completion = normalizeCompletion(result.content, input.prefix);
    if (!completion.trim()) {
      throw new InlineAIError("empty", "The model returned no usable completion.");
    }
    return { text: completion, servedModel: result.servedModel, gatewayLatencyMs: result.latencyMs };
  } catch (error) {
    if (error instanceof InlineAIError) throw error;
    throwGatewayError(error, "inline-complete");
  }
}

/* ------------------------------------------------------------------ */
/* 2. Cmd/Ctrl+K inline edit proposal                                   */
/* ------------------------------------------------------------------ */

export interface InlineEditInput {
  path: string;
  language: string;
  instruction: string;
  code: string;
  /** Short context before/after the selection (optional, client-trimmed). */
  prefixContext: string;
  suffixContext: string;
}

export async function inlineEdit(input: InlineEditInput): Promise<InlineAIResult> {
  const blocks = [
    `File: ${input.path} (${input.language})`,
    input.prefixContext.trim()
      ? `[Context before selection]\n${input.prefixContext}`
      : "",
    input.suffixContext.trim()
      ? `[Context after selection]\n${input.suffixContext}`
      : "",
    `[Selected code to edit]\n${input.code}`,
    `[Instruction]\n${input.instruction}`,
  ].filter(Boolean);

  try {
    const result = await LLMGateway.complete({
      messages: [
        {
          role: "assistant",
          content:
            "You are a precise code editing engine. Apply the user's instruction to the selected code. " +
            "Reply with ONLY the full replacement code for the selection — no markdown fences, no " +
            "commentary, no surrounding explanations. Preserve the file's indentation and style. Keep " +
            "unrelated parts of the selection unchanged.",
        },
        { role: "user", content: blocks.join("\n\n") },
      ],
      thinking: { type: "disabled" },
    });
    const replacement = stripFences(result.content);
    if (!replacement.trim()) {
      throw new InlineAIError("empty", "The model returned no edit proposal.");
    }
    return { text: replacement, servedModel: result.servedModel, gatewayLatencyMs: result.latencyMs };
  } catch (error) {
    if (error instanceof InlineAIError) throw error;
    throwGatewayError(error, "inline-edit");
  }
}

/* ------------------------------------------------------------------ */
/* 3. Hinglish explanation (hover)                                      */
/* ------------------------------------------------------------------ */

export interface ExplainHinglishInput {
  path: string;
  language: string;
  symbol: string;
  kind: string | null;
  /** The symbol's line (1-based) inside `code`. */
  line: number | null;
  code: string;
}

export async function explainHinglish(input: ExplainHinglishInput): Promise<InlineAIResult> {
  const symbolHeader = input.kind
    ? `${input.kind} ${input.symbol} (line ${input.line ?? "?"})`
    : `${input.symbol} (line ${input.line ?? "?"})`;
  try {
    const result = await LLMGateway.complete({
      messages: [
        {
          role: "assistant",
          content:
            "You explain code to Indian developers in Hinglish — Hindi + English mix, always written " +
            "in Latin script (jaise: \"ye function file ko read karke uska size return karta hai\"). " +
            "Explain what the code does, why it exists and anything risky — simple chhote sentences, " +
            "under 120 words. Plain text only: no markdown headings, no code fences, no bullet points.",
        },
        {
          role: "user",
          content: `File: ${input.path} (${input.language})\nSymbol: ${symbolHeader}\n\n\`\`\`\n${input.code}\n\`\`\`\n\nExplain this symbol in Hinglish.`,
        },
      ],
      thinking: { type: "disabled" },
    });
    const explanation = result.content.trim();
    if (!explanation) {
      throw new InlineAIError("empty", "The model returned no explanation.");
    }
    return { text: explanation, servedModel: result.servedModel, gatewayLatencyMs: result.latencyMs };
  } catch (error) {
    if (error instanceof InlineAIError) throw error;
    throwGatewayError(error, "explain-hinglish");
  }
}
