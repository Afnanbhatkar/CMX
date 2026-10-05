import { isCasualPrompt } from "@/lib/casual-prompt";
import {
  GATEWAY_PROVIDER,
  LLMGateway,
  type GatewayMessage,
} from "@/server/llm/llm-gateway";
import { withSpan } from "@/server/observability/tracing";
import { logError, logWarn } from "@/server/security/logger";
import {
  APPROVAL_MARKER,
  UNCERTAINTY_LEVELS,
  type ComposerMode,
  type EvidenceBackedClaim,
  type MemoryRecord,
  type ResponseTemplate,
  type StructuredCodeBlock,
  type StructuredReference,
  type StructuredResponse,
  type UncertaintyLevel,
} from "@/features/workspace/assistant/contracts";
import type { AssistantStageEvent } from "./assistant-service";
import {
  evidenceVerifies,
  extractFileRefs,
  verifyReferences,
  verifySymbols,
} from "./reference-verifier";

/**
 * CodeMind X V2 — Phase 8.5 Response Engine.
 *
 * Pipeline (per the phase contract):
 *
 *   Draft (already streamed markdown)
 *     → Structured Output   (a SECOND real gateway call distills the draft
 *                            into typed JSON — never parsed out of the body
 *                            by the UI)
 *     → Reference Verifier  (every file path / line / symbol checked against
 *                            repository intelligence — real code, no LLM)
 *     → Critic              (rule-based completeness + consistency checks
 *                            with human-readable findings)
 *     → Refine              (deterministic fixes: downgrade unverified
 *                            "confirmed" claims, annotate references,
 *                            derive the overall uncertainty)
 *     → Render              (the UI renders the typed payload; this module
 *                            emits RESPONSE_STRUCTURED)
 *
 * Honesty rules (RULES.md §9): when the structured call fails or the model
 * returns unusable JSON, `structured.note` says exactly that and the UI
 * falls back to plain markdown — nothing is fabricated.
 */

export interface ResponseEngineInput {
  runId: string;
  mode: ComposerMode;
  /** The final draft (approval block already stripped). */
  draft: string;
  /** The user's latest query (skip heuristics + template choice). */
  query: string;
  /** The REAL memory records this run used (MEMORY_USED). */
  memories: MemoryRecord[];
  /** Real retrieval file paths for this run (verifier context). */
  retrievalFiles: string[];
  onStage?: (event: AssistantStageEvent) => void;
}

export interface ResponseEngineResult {
  structured: StructuredResponse | null;
}

/** Below this size a structured view adds nothing — skipped honestly. */
const MIN_DRAFT_CHARS = 80;
/** Bounds that keep the payload sane (model output is trimmed, never invented). */
const MAX_CLAIMS = 8;
const MAX_FILES = 10;
const MAX_SYMBOLS = 8;
const MAX_FOLLOWUPS = 4;
const MAX_SOURCES = 6;

/** A fenced code block parsed from the DRAFT (the code text source of truth). */
export interface DraftCodeFence {
  language: string;
  meta: string;
  code: string;
}

/** Parse the draft's fenced code blocks (skipping the approval marker). */
export function parseDraftFences(draft: string): DraftCodeFence[] {
  const fences: DraftCodeFence[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(draft)) !== null) {
    const info = (m[1] ?? "").trim();
    if (info.startsWith(APPROVAL_MARKER)) continue;
    const [language = "", ...metaParts] = info.split(/\s+/);
    fences.push({ language, meta: metaParts.join(" "), code: m[2].replace(/\n$/, "") });
    if (fences.length >= 12) break;
  }
  return fences;
}

/** A model-proposed filename → real workspace reference check (used by refine). */
function filenameCandidate(filename: string, draftMeta: string): { raw: string; path: string; line: number | null; lineEnd: number | null } | null {
  const raw = (filename || draftMeta || "").trim();
  if (!raw || !/\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|py|go|rs|java|sh|sql|prisma|yml|yaml|toml)$/i.test(raw)) {
    return null;
  }
  const colon = /^(.*?\.[a-z]+):(\d{1,5})(?:-(\d{1,5}))?$/i.exec(raw);
  if (colon) {
    return { raw, path: colon[1], line: Number(colon[2]), lineEnd: colon[3] ? Number(colon[3]) : null };
  }
  return { raw, path: raw, line: null, lineEnd: null };
}

/* ------------------------------------------------------------------ */
/* Structured Output (LLM call #2)                                     */
/* ------------------------------------------------------------------ */

const STRUCTURED_SCHEMA_INSTRUCTION = [
  "You convert an engineering answer into a STRICT JSON object. Output ONLY the JSON object — no prose, no markdown fence.",
  "Shape (omit a key entirely when the answer has nothing for it; use [] for empty lists):",
  "{",
  '  "template": "explain" | "debug" | "review" | "architecture" | "general",',
  '  "summary": string  // one or two sentences — TL;DR for explain, root cause for debug, overview for architecture',
  '  "claims": [{ "statement": string, "uncertainty": "confirmed" | "likely" | "potential" | "unknown", "evidence": string | null }],',
  '     // claims = the material factual assertions a reviewer would check. "confirmed" REQUIRES evidence naming a real file you were given (path or path:line). "likely" = strong indirect evidence (say what). "potential" = assumption (state it). "unknown" = say what is missing. Max 8, most important first.',
  '  "files": [string],  // repository paths this answer is ABOUT, with optional :line or :start-end (e.g. "src/x.ts:12-20"). ONLY paths that appear in the conversation. Max 10.',
  '  "symbols": [string],  // function/class/type names this answer is about. Only names that appear in the provided context. Max 8.',
  '  "code": [{ "language": string, "filename": string | null, "lineStart": number | null, "lineEnd": number | null, "status": "generated" | "modified", "highlightLines": [number] }],',
  '     // ONE entry per fenced code block in the answer, IN ORDER. Do NOT repeat the code text. status "modified" when it edits an existing named file, else "generated". highlightLines = lines of the NAMED REAL FILE the block changes (empty for generated snippets).',
  '  "actions": [{ "label": string, "action": string }],  // short follow-up actions the user might take. Max 4.',
  '  "sources": [string],  // paths:lines that back the answer (subset of provided context). Max 6.',
  '  "followups": [string],  // concrete next steps / open questions. Max 4.',
  "}",
  "Rules: never invent paths, symbols or line numbers that were not in the conversation; when unsure, leave the key out or use uncertainty \"unknown\". No evaluative \"winner\" claims — keep recommendations evidence-based.",
].join("\n");

interface RawStructured {
  template?: unknown;
  summary?: unknown;
  claims?: unknown;
  files?: unknown;
  symbols?: unknown;
  code?: unknown;
  actions?: unknown;
  sources?: unknown;
  followups?: unknown;
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
const asStringArray = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, max)
    : [];
const asNumberOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

/** Parse + leniently validate the model's JSON (unusable → null, honestly). */
function parseStructuredJson(rawText: string): RawStructured | null {
  let text = rawText.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as RawStructured;
  } catch {
    return null;
  }
}

async function requestStructured(
  draft: string,
  mode: ComposerMode,
): Promise<{ raw: RawStructured | null; via: string; note: string | null }> {
  const messages: GatewayMessage[] = [
    {
      role: "assistant",
      content: [
        "You are the structured-output stage of the CodeMind X response pipeline. You produce a JSON summary of an existing engineering answer.",
        "Answer template preference by run mode — search→explain, code→debug when the answer fixes something else explain, agent→explain or architecture when the plan describes components.",
        STRUCTURED_SCHEMA_INSTRUCTION,
      ].join("\n\n"),
    },
    {
      role: "user",
      content: `Run mode: ${mode}\n\nAnswer to structure:\n\n${draft.slice(0, 24_000)}`,
    },
  ];
  try {
    const result = await withSpan(
      "response-engine.structured",
      { provider: GATEWAY_PROVIDER, stage: "structured-output" },
      () => LLMGateway.complete({ messages, thinking: { type: "disabled" } }),
    );
    const raw = parseStructuredJson(result.content);
    return raw
      ? { raw, via: "llm-structured+rule-critic", note: null }
      : { raw: null, via: "rule-derived-fallback", note: "The structured-output call did not return usable JSON — reference verification ran on what the answer itself referenced." };
  } catch (error) {
    logWarn("response-engine: structured call failed (fallback to rule-derived)", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { raw: null, via: "rule-derived-fallback", note: "The structured-output call failed — reference verification ran on what the answer itself referenced." };
  }
}

/* ------------------------------------------------------------------ */
/* Critic (rule-based)                                                 */
/* ------------------------------------------------------------------ */

interface CriticOutcome {
  notes: string[];
  claims: EvidenceBackedClaim[];
  /** evidence refs per claim index (for the UI evidence panel). */
}

async function runCriticAndRefine(
  raw: RawStructured | null,
  draft: string,
  fences: DraftCodeFence[],
): Promise<CriticOutcome & { notes: string[] }> {
  const notes: string[] = [];

  // ---- claims: normalize + verify evidence + downgrade unverified "confirmed"
  const rawClaims = Array.isArray(raw?.claims) ? raw?.claims : [];
  const claims: EvidenceBackedClaim[] = [];
  for (const entry of rawClaims.slice(0, MAX_CLAIMS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const statement = asString(record.statement);
    if (!statement) continue;
    const uncertaintyRaw = asString(record.uncertainty);
    let uncertainty: UncertaintyLevel = UNCERTAINTY_LEVELS.includes(
      uncertaintyRaw as UncertaintyLevel,
    )
      ? (uncertaintyRaw as UncertaintyLevel)
      : "likely";
    const evidence = asString(record.evidence);
    let finalEvidence = evidence;
    if (uncertainty === "confirmed") {
      const verdict = await evidenceVerifies(evidence);
      if (!verdict.ok) {
        uncertainty = "likely";
        notes.push(
          `Claim downgraded Confirmed → Likely (evidence did not verify against the workspace): "${statement.slice(0, 80)}${statement.length > 80 ? "…" : ""}"`,
        );
        finalEvidence = evidence
          ? `${evidence} — could not be verified against the repository`
          : "no verifiable evidence — strong reasoning only";
      }
    }
    if (uncertainty === "unknown" && finalEvidence) {
      finalEvidence = `${finalEvidence}`;
    }
    if (uncertainty === "unknown" && !finalEvidence) {
      finalEvidence = "missing evidence — what would confirm this is not in the provided context";
    }
    claims.push({ statement, uncertainty, evidence: finalEvidence });
  }
  if (rawClaims.length > MAX_CLAIMS) notes.push(`Claims trimmed to the ${MAX_CLAIMS} most important.`);

  return { notes, claims };
}

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

export async function buildStructuredResponse(
  input: ResponseEngineInput,
): Promise<ResponseEngineResult> {
  const { runId, mode, draft, query, memories, onStage } = input;

  // Honest skips: casual greetings and very short answers need no structure.
  if (isCasualPrompt(query) || draft.trim().length < MIN_DRAFT_CHARS) {
    return { structured: null };
  }

  const verifyId = "verify-response";
  onStage?.({
    type: "ACTIVITY_STARTED",
    activity: {
      id: verifyId,
      kind: "steps",
      title: "Verifying response",
      summary: null,
      metadata: null,
      children: [],
    },
  });

  try {
    const fences = parseDraftFences(draft);

    // ---- Stage 1: Structured Output (real second gateway call) ----
    const { raw, via, note } = await requestStructured(draft, mode);

    // ---- Stage 2: Reference Verifier (real code against the index) ----
    const candidateRefs = new Map<string, { raw: string; path: string; line: number | null; lineEnd: number | null }>();
    const addCandidate = (candidate: { raw: string; path: string; line: number | null; lineEnd: number | null } | null) => {
      if (!candidate) return;
      const key = candidate.raw.toLowerCase();
      if (!candidateRefs.has(key)) candidateRefs.set(key, candidate);
    };

    for (const ref of asStringArray(raw?.files, MAX_FILES)) {
      const colon = /^(.*?\.[a-z]+):(\d{1,5})(?:-(\d{1,5}))?$/i.exec(ref);
      if (colon) {
        addCandidate({ raw: ref, path: colon[1], line: Number(colon[2]), lineEnd: colon[3] ? Number(colon[3]) : null });
      } else {
        addCandidate({ raw: ref, path: ref, line: null, lineEnd: null });
      }
    }
    for (const source of asStringArray(raw?.sources, MAX_SOURCES)) {
      const colon = /^(.*?\.[a-z]+):(\d{1,5})(?:-(\d{1,5}))?$/i.exec(source);
      if (colon) {
        addCandidate({ raw: source, path: colon[1], line: Number(colon[2]), lineEnd: colon[3] ? Number(colon[3]) : null });
      } else {
        addCandidate({ raw: source, path: source, line: null, lineEnd: null });
      }
    }
    // Evidence refs from the model's claims (verify every evidence path too).
    const rawClaimList = Array.isArray(raw?.claims) ? raw?.claims : [];
    for (const entry of rawClaimList) {
      if (typeof entry !== "object" || entry === null) continue;
      const evidence = asString((entry as Record<string, unknown>).evidence);
      if (!evidence) continue;
      for (const candidate of extractFileRefs(evidence)) addCandidate(candidate);
    }
    // Fallback (rule-derived path): what the DRAFT itself references.
    if (!raw) {
      for (const candidate of extractFileRefs(draft)) addCandidate(candidate);
    }
    // Code-block filenames become candidates too.
    const rawCode = Array.isArray(raw?.code) ? raw?.code : [];
    rawCode.forEach((entry, i) => {
      if (typeof entry !== "object" || entry === null) return;
      const record = entry as Record<string, unknown>;
      const filename = asString(record.filename);
      const fence = fences[i];
      addCandidate(filenameCandidate(filename ?? "", fence?.meta ?? ""));
    });

    const verifiedRefs = await verifyReferences([...candidateRefs.values()]);

    // ---- Symbols ----
    const rawSymbols = asStringArray(raw?.symbols, MAX_SYMBOLS);
    const verifiedSymbols = await verifySymbols(rawSymbols);
    if (!raw) {
      // Rule-derived fallback symbols: pull code-ish identifiers from the draft's fences — skipped (too noisy). Symbols stay empty honestly.
    }

    // ---- Stage 3+4: Critic + Refine ----
    const { notes: criticNotes, claims } = await runCriticAndRefine(raw, draft, fences);

    // Files: verified model files + retrieval context files the draft is about
    // (retrieval paths are REAL workspace files — they carry verified status
    // with the honest note that they came from retrieval, not the model).
    const files: StructuredReference[] = [];
    const seenPaths = new Set<string>();
    for (const ref of verifiedRefs) {
      if (seenPaths.has(ref.path)) continue;
      seenPaths.add(ref.path);
      files.push(ref);
    }
    for (const file of input.retrievalFiles.slice(0, MAX_FILES)) {
      if (seenPaths.has(file)) continue;
      seenPaths.add(file);
      files.push({
        raw: file,
        path: file,
        line: null,
        lineEnd: null,
        status: "verified",
        lineCount: null,
        note: "retrieved for this run (context file)",
      });
      if (files.length >= MAX_FILES + 4) break;
    }
    if (files.length > MAX_FILES) {
      const overflow = files.length - MAX_FILES;
      files.length = MAX_FILES;
      criticNotes.push(`File list trimmed to ${MAX_FILES} (${overflow} dropped).`);
    }

    // Code metadata: pair the model's entries with the draft fences IN ORDER.
    const code: StructuredCodeBlock[] = fences.map((fence, i) => {
      const entry = (typeof rawCode[i] === "object" && rawCode[i] !== null ? rawCode[i] : {}) as Record<string, unknown>;
      const modelFilename = asString(entry.filename);
      const metaFilename = /^(?:\/\/|#)\s*file:\s*(\S+)/.exec(fence.meta)?.[1] ?? (/\.[a-z]+$/i.test(fence.meta.trim()) ? fence.meta.trim() : null);
      const filename = modelFilename ?? metaFilename ?? null;
      const candidate = filenameCandidate(filename ?? "", fence.meta);
      const verified = verifiedRefs.find(
        (r) => candidate && r.path === candidate.path.replace(/^\.\//, "").replace(/^\//, ""),
      );
      const lineStart = asNumberOrNull(entry.lineStart);
      const lineEnd = asNumberOrNull(entry.lineEnd);
      const statusRaw = asString(entry.status);
      const highlightLines = Array.isArray(entry.highlightLines)
        ? entry.highlightLines.filter((n): n is number => typeof n === "number" && Number.isFinite(n)).slice(0, 20)
        : [];
      return {
        language: asString(entry.language) ?? fence.language ?? "code",
        filename,
        lineStart,
        lineEnd,
        status: statusRaw === "modified" ? "modified" : "generated",
        highlightLines,
        fileStatus: verified?.status ?? "unknown",
      } satisfies StructuredCodeBlock;
    });

    // Actions + followups + summary + template.
    const rawActions = Array.isArray(raw?.actions) ? raw?.actions : [];
    const actions = rawActions
      .map((entry) => {
        if (typeof entry !== "object" || entry === null) return null;
        const record = entry as Record<string, unknown>;
        const label = asString(record.label);
        const action = asString(record.action);
        return label && action ? { label, action } : null;
      })
      .filter((a): a is { label: string; action: string } => a !== null)
      .slice(0, 4);

    let followups = asStringArray(raw?.followups, MAX_FOLLOWUPS);
    // Critic refinement: a debug answer without a verify step gets an honest followup.
    const templateRaw = asString(raw?.template);
    const template: ResponseTemplate =
      templateRaw === "explain" ||
      templateRaw === "debug" ||
      templateRaw === "review" ||
      templateRaw === "architecture"
        ? templateRaw
        : "general";
    if (template === "debug" && followups.length === 0) {
      followups = ["Run the failing case again and confirm the fix holds."];
      criticNotes.push("Debug template: no verify step — an honest follow-up was added.");
    }

    const summary = asString(raw?.summary);
    if (!summary && raw) criticNotes.push("The structured output had no summary — the TL;DR slot is empty rather than invented.");

    // Overall uncertainty (derived from the claim set + verification reality).
    let level: UncertaintyLevel = "confirmed";
    let reason: string | null = "Every material claim carries verified evidence.";
    if (claims.some((c) => c.uncertainty === "unknown")) {
      level = "unknown";
      reason = "At least one material claim is explicitly Unknown — something needed for certainty is missing.";
    } else if (claims.some((c) => c.uncertainty === "potential")) {
      level = "potential";
      reason = "Part of the answer rests on stated assumptions.";
    } else if (claims.some((c) => c.uncertainty === "likely")) {
      level = "likely";
      reason = "Some claims rest on strong indirect evidence rather than direct reads.";
    } else if (claims.length === 0) {
      level = "likely";
      reason = "No explicit claims were labeled — verify against the repository before acting.";
    }
    const unknownCount = files.filter((f) => f.status === "unknown").length;
    if (unknownCount > 0) {
      reason = `${reason} ${unknownCount} reference${unknownCount === 1 ? "" : "s"} could not be verified in the workspace.`;
    }

    // Sources: only verified ones survive.
    const sources = verifiedRefs.filter(
      (r) => r.status === "verified" && asStringArray(raw?.sources, MAX_SOURCES).some((s) => s.startsWith(r.path)),
    ).slice(0, MAX_SOURCES);

    const verifiedCount = files.filter((f) => f.status === "verified").length;
    const structured: StructuredResponse = {
      version: "8.5",
      runId,
      template,
      summary,
      claims,
      files,
      symbols: verifiedSymbols,
      code,
      actions,
      sources,
      uncertainty: { level, reason },
      followups,
      memoryUsed: memories.map((m) => ({ id: m.id, label: m.scope ?? m.id, source: m.source })),
      verification: {
        verifiedCount,
        unknownCount,
        criticNotes,
        verifiedAt: Date.now(),
        via,
        note,
      },
    };

    onStage?.({ type: "RESPONSE_STRUCTURED", structured });
    onStage?.({
      type: "ACTIVITY_COMPLETED",
      activityId: verifyId,
      summary: `${verifiedCount} verified · ${unknownCount} unknown reference${unknownCount === 1 ? "" : "s"}`,
    });
    return { structured };
  } catch (error) {
    logError("response-engine: verification failed (answer unaffected)", {
      runId,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    onStage?.({
      type: "ACTIVITY_COMPLETED",
      activityId: verifyId,
      summary: "Verification failed — the answer was not changed",
    });
    return { structured: null };
  }
}
