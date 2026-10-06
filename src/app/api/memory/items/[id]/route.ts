/**
 * /api/memory/items/[id] — Phase 9.5.
 *   PATCH  — update title/content/status (disable/enable)/evidence/expiry.
 *            Proposed (inferred) items cannot be activated here — that must
 *            go through the Memory Inbox accept action (spec §6).
 *   DELETE — permanently remove the item (append-only events remain).
 */

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";

import { deleteMemoryItem, updateMemoryItem } from "@/server/memory/engine";
import { updateMemoryItemSchema } from "@/server/memory/types";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export const PATCH = withApi<RouteCtx>(
  async (req, ctx) => {
    const { id } = await ctx.params;
    const body = updateMemoryItemSchema.parse(await req.json());
    const item = await updateMemoryItem(id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.evidenceRefs !== undefined ? { evidenceRefs: body.evidenceRefs } : {}),
      ...(body.expiresAt !== undefined
        ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
        : {}),
    });
    return jsonOk({ item });
  },
  { allowBody: true },
);

export const DELETE = withApi<RouteCtx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const result = await deleteMemoryItem(id);
  return jsonOk(result);
});
