/**
 * CodeMind X V2 — audit log foundation (V2.1 §D).
 *
 * Append-only audit trail over the `audit_logs` table (schema comment holds
 * the same closed vocabularies). Honesty rules:
 * - `record()` NEVER throws into the caller: audit failures are logged
 *   server-side and dropped — auditing must never break a request;
 * - metadata must NEVER contain secrets, credentials, tokens, file contents
 *   or model reasoning (RULES.md §5/§9) — callers pass small operational
 *   objects (ids, paths, scopes) which are JSON-serialized defensively;
 * - NO action is recorded without a real event behind it. Actions without a
 *   producer are exported for typing only and are explicitly marked
 *   "wired when the feature arrives" — do not audit-fabricate.
 */

import { db } from "@/lib/db";
import { logWarn } from "@/server/security/logger";

/** Closed action vocabulary — mirrors the AuditLog schema comment. */
export const AUDIT_ACTIONS = {
  login: "login",
  repositoryAccess: "repository.access",
  repositoryImport: "repository.import",
  approvalGranted: "approval.granted",
  approvalRejected: "approval.rejected",
  gitMutation: "git.mutation",
  memoryChange: "memory.change",
  agentAutonomyChange: "agent.autonomy.change",
  mcpToolInvocation: "mcp.tool.invocation",
  other: "other",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditActorType = "user" | "system" | "agent" | "service";

export interface AuditRecordInput {
  actorType: AuditActorType;
  actorId?: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  /** Repository.id reference — omit when no repository row applies. */
  repositoryId?: string;
  requestId?: string;
  /** Small, secret-free operational metadata (JSON-serialized). */
  metadata?: Record<string, unknown>;
}

/** Serialize metadata defensively; never let bad metadata break an insert. */
function serializeMetadata(metadata?: Record<string, unknown>): string | null {
  if (metadata === undefined) return null;
  try {
    return JSON.stringify(metadata);
  } catch {
    return '{"note":"metadata serialization failed"}';
  }
}

interface AuditRowData {
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  repositoryId: string | null;
  requestId: string | null;
  metadata: string | null;
}

/**
 * Write path with a stale-client fallback:
 * - normal path: the typed `db.auditLog` delegate;
 * - fallback: raw SQL against the SAME real `audit_logs` table. It exists for
 *   a server process that was started BEFORE the V2.1 models were pushed and
 *   the Prisma client regenerated — its in-process (globalThis-cached)
 *   PrismaClient then has no `auditLog` delegate. The delegate path resumes
 *   automatically after the next server process reload. No other behavior
 *   differs: both paths write the same columns of the same table.
 */
async function insertAuditLog(data: AuditRowData): Promise<void> {
  const delegate = (db as unknown as Record<string, unknown>).auditLog as
    | { create: (args: { data: AuditRowData }) => Promise<unknown> }
    | undefined;
  if (delegate && typeof delegate.create === "function") {
    await delegate.create({ data });
    return;
  }
  const now = new Date().toISOString();
  await db.$executeRaw`
    INSERT INTO "audit_logs"
      ("id", "actorType", "actorId", "action", "targetType", "targetId", "repositoryId", "requestId", "metadata", "createdAt", "updatedAt")
    VALUES
      (${crypto.randomUUID()}, ${data.actorType}, ${data.actorId}, ${data.action},
       ${data.targetType}, ${data.targetId}, ${data.repositoryId}, ${data.requestId},
       ${data.metadata}, ${now}, ${now})`;
}

/**
 * Record one audit event. Fire-and-forget friendly: resolves to `true` when
 * persisted, `false` when dropped (failure logged server-side, never thrown).
 */
export async function recordAudit(input: AuditRecordInput): Promise<boolean> {
  try {
    await insertAuditLog({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      repositoryId: input.repositoryId ?? null,
      requestId: input.requestId ?? null,
      metadata: serializeMetadata(input.metadata),
    });
    return true;
  } catch (error) {
    logWarn("audit: record failed (caller unaffected)", {
      action: input.action,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return false;
  }
}

/**
 * The audit surface used by callers (`audit.record(...)`, `audit.login(...)`).
 */
export const audit = {
  record: recordAudit,

  /**
   * Real event: a session was created/validated through the auth session
   * lifecycle (see src/server/security/auth.ts). No other login path exists.
   */
  login(input: {
    actorId: string;
    targetType?: string;
    targetId?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    return recordAudit({
      actorType: "user",
      actorId: input.actorId,
      action: AUDIT_ACTIONS.login,
      targetType: input.targetType,
      targetId: input.targetId,
      requestId: input.requestId,
      metadata: input.metadata,
    });
  },

  /**
   * Real event: a workspace file/tree was read through the repository APIs.
   * Metadata carries the path or { scope: "tree" } — NEVER file content.
   */
  repositoryAccess(input: {
    requestId?: string;
    repositoryId?: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    return recordAudit({
      actorType: "user", // user-initiated read; unauthenticated local mode today
      action: AUDIT_ACTIONS.repositoryAccess,
      requestId: input.requestId,
      repositoryId: input.repositoryId,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
    });
  },

  // --- Actions with NO real event source yet — typed for later phases only. ---
  // repository.import — wired when the feature arrives (import route owner).
  // approval.granted / approval.rejected — wired when the feature arrives
  //   (ApprovalCard flows, RULES.md §6).
  // git.mutation — wired when the feature arrives (git write operations).
  // memory.change — wired when the feature arrives (memory service writes).
  // agent.autonomy.change — wired when the feature arrives (L0–L3 changes).
  // mcp.tool.invocation — wired when the feature arrives (MCP tool runtime).
};
