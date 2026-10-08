/**
 * CodeMind X V2 — Agent Mode V2 ChangeSet application (spec §14/§15/§16/§17/
 * §20/§42/§43/§48/§49).
 *
 * The bridge between an APPROVED ChangeSet and the real mutation service:
 *
 * - idempotent: an already-applied ChangeSet is never applied twice
 *   (spec §42 — the run reports "already applied" instead);
 * - ordered: folders first, then creates, then modifies, then deletes —
 *   mutations are strictly sequential (spec §91);
 * - version-safe: every modify/delete carries the proposal-time hash; a
 *   file that changed since the proposal aborts the apply with a CONFLICT
 *   result and nothing is written for that change (spec §17/§43);
 * - verified: every operation is re-read from disk and compared (spec §16);
 *   a byte-identical "modify" is a NO-OP failure (spec §84);
 * - honest: partial failure is a structured result, never a success
 *   (spec §41/§107).
 */

import { db } from "@/lib/db";
import {
  computeLineDiff,
  createFile,
  createFolder,
  deleteFile,
  writeFileContent,
  type DiffLine,
} from "@/lib/server/workspace-mutation";

/** The structured result of applying one approved ChangeSet. */
export interface ApplyOperationResult {
  changeId: string;
  path: string;
  operation: "create" | "modify" | "delete";
  ok: boolean;
  verified: boolean;
  error: string | null;
  noOp: boolean;
  /** Real before/after line diff (display only — from actual disk content). */
  diff: DiffLine[] | null;
}

export interface ApplyChangeSetResult {
  ok: boolean;
  alreadyApplied: boolean;
  /** A version conflict stopped the apply — the caller re-plans (spec §122). */
  conflict: { path: string; error: string } | null;
  changeSetPublicId: string | null;
  operations: ApplyOperationResult[];
  createdFolders: string[];
  failedFolders: string[];
}

/** The JSON payload persisted on each CodeChange.diff by the coding agent. */
export interface CodeChangePayload {
  kind: "codemind-change-v1";
  /** Full new file content for add/modify (null for delete). */
  after: string | null;
  /** The proposal-time content for modify (null for add). */
  before: string | null;
  /** sha256 of the proposal-time file content (null for add). */
  baseHash: string | null;
  /** The model's own short description of the change. */
  rationale: string | null;
}

export function parseCodeChangePayload(raw: string | null): CodeChangePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.kind !== "codemind-change-v1") return null;
    return {
      kind: "codemind-change-v1",
      after: typeof parsed.after === "string" ? parsed.after : null,
      before: typeof parsed.before === "string" ? parsed.before : null,
      baseHash: typeof parsed.baseHash === "string" ? parsed.baseHash : null,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : null,
    };
  } catch {
    return null;
  }
}

/** Content size caps — aligned with the read service's honest limits. */
const MAX_CONTENT_BYTES = 512 * 1024;

/**
 * Apply one APPROVED ChangeSet to the real workspace.
 * Emits progress through `onEvent` so the thought chain shows every real
 * operation (spec §8/§44) — the caller maps these onto its stream.
 */
export async function applyChangeSet(opts: {
  runInternalId: string;
  onFolderEvent?: (path: string, ok: boolean, error: string | null) => void;
  onOperationStarted?: (op: { path: string; operation: "create" | "modify" | "delete" }) => void;
  onOperationCompleted?: (result: ApplyOperationResult) => void;
}): Promise<ApplyChangeSetResult> {
  const { runInternalId } = opts;
  const changeSet = await db.changeSet.findFirst({
    where: { runId: runInternalId, status: "proposed" },
    orderBy: { createdAt: "desc" as const },
    include: {
      changes: {
        // Per-file exclusion (user removed chips on the approval card):
        // discarded rows are NEVER applied — only still-proposed changes.
        where: { status: "proposed" },
        orderBy: { createdAt: "asc" as const },
      },
    },
  });

  if (!changeSet) {
    // Nothing proposed (e.g. approval recorded after a re-plan discarded it).
    return {
      ok: false,
      alreadyApplied: false,
      conflict: null,
      changeSetPublicId: null,
      operations: [],
      createdFolders: [],
      failedFolders: [],
    };
  }

  if (changeSet.status === "applied") {
    return {
      ok: true,
      alreadyApplied: true,
      conflict: null,
      changeSetPublicId: changeSet.publicId,
      operations: [],
      createdFolders: [],
      failedFolders: [],
    };
  }

  const operations: ApplyOperationResult[] = [];
  const createdFolders: string[] = [];
  const failedFolders: string[] = [];
  let conflict: { path: string; error: string } | null = null;

  const finish = async (ok: boolean): Promise<ApplyChangeSetResult> => {
    await db.changeSet
      .update({
        where: { id: changeSet.id },
        data: { status: ok ? "applied" : "discarded" },
      })
      .catch(() => undefined);
    return {
      ok,
      alreadyApplied: false,
      conflict,
      changeSetPublicId: changeSet.publicId,
      operations,
      createdFolders,
      failedFolders,
    };
  };

  // ---- Folders first (every create's parent chain, deduped, spec §87) ----
  const folderPaths = new Set<string>();
  for (const change of changeSet.changes) {
    if (change.changeKind !== "add") continue;
    const normalized = change.path.replace(/\\/g, "/").replace(/\/+$/, "");
    const parent = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
    if (parent) folderPaths.add(parent);
  }
  for (const folder of [...folderPaths].sort()) {
    const result = await createFolder(folder);
    if (result.ok) createdFolders.push(folder);
    else failedFolders.push(folder);
    opts.onFolderEvent?.(folder, result.ok, result.error);
  }

  // ---- File operations, sequential, ordered create → modify → delete ----
  const order: Record<string, number> = { add: 0, modify: 1, delete: 2 };
  const ordered = [...changeSet.changes].sort(
    (a, b) => (order[a.changeKind] ?? 3) - (order[b.changeKind] ?? 3),
  );

  for (const change of ordered) {
    const operation =
      change.changeKind === "add" ? ("create" as const) : change.changeKind === "modify" ? ("modify" as const) : ("delete" as const);
    opts.onOperationStarted?.({ path: change.path, operation });

    const payload = parseCodeChangePayload(change.diff);
    let result: ApplyOperationResult;

    if (!payload) {
      result = {
        changeId: change.id,
        path: change.path,
        operation,
        ok: false,
        verified: false,
        error: "change payload missing or corrupted — nothing was written",
        noOp: false,
        diff: null,
      };
    } else if (payload.after !== null && payload.after.length * 4 > MAX_CONTENT_BYTES) {
      result = {
        changeId: change.id,
        path: change.path,
        operation,
        ok: false,
        verified: false,
        error: "proposed content exceeds the safe size limit — nothing was written",
        noOp: false,
        diff: null,
      };
    } else if (operation === "create") {
      const mutation = await createFile(change.path, payload.after ?? "");
      const diff =
        mutation.ok || mutation.error?.includes("already exists")
          ? computeLineDiff("", payload.after ?? "")
          : null;
      result = {
        changeId: change.id,
        path: change.path,
        operation,
        ok: mutation.ok,
        verified: mutation.verified,
        error: mutation.error,
        noOp: false,
        diff,
      };
    } else if (operation === "modify") {
      const mutation = await writeFileContent(change.path, payload.after ?? "", payload.baseHash);
      const diff =
        mutation.error && mutation.error.startsWith("version conflict")
          ? null
          : computeLineDiff(payload.before ?? "", payload.after ?? "");
      result = {
        changeId: change.id,
        path: change.path,
        operation,
        ok: mutation.ok,
        verified: mutation.verified,
        error: mutation.error,
        noOp: mutation.noOp === true,
        diff,
      };
      if (mutation.error?.startsWith("version conflict")) {
        conflict = { path: change.path, error: mutation.error };
      }
    } else {
      const mutation = await deleteFile(change.path, payload.baseHash);
      result = {
        changeId: change.id,
        path: change.path,
        operation,
        ok: mutation.ok,
        verified: mutation.verified,
        error: mutation.error,
        noOp: false,
        diff: null,
      };
      if (mutation.error?.startsWith("version conflict")) {
        conflict = { path: change.path, error: mutation.error };
      }
    }

    await db.codeChange
      .update({
        where: { id: change.id },
        data: {
          status: result.ok ? "applied" : "proposed",
          diff: JSON.stringify({
            kind: "codemind-change-v1",
            after: payload?.after ?? null,
            before: payload?.before ?? null,
            baseHash: payload?.baseHash ?? null,
            rationale: payload?.rationale ?? null,
            applied: result.ok,
            verified: result.verified,
            noOp: result.noOp,
            error: result.error,
          } satisfies CodeChangePayload & { applied: boolean; verified: boolean; noOp: boolean; error: string | null }).slice(0, 1_000_000),
        },
      })
      .catch(() => undefined);

    operations.push(result);
    opts.onOperationCompleted?.(result);

    // A conflict or a hard failure stops the sequential apply — never
    // continue writing after a version guard tripped (spec §43).
    if (conflict) break;
    if (!result.ok && !result.noOp) break;
  }

  const ok =
    !conflict &&
    failedFolders.length === 0 &&
    operations.length > 0 &&
    operations.every((op) => op.ok || op.noOp);

  return finish(ok);
}
