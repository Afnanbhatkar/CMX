/**
 * /api/memory/items — Phase 9.5 Adaptive Memory Engine.
 *   GET  — list items (filters: status, type, scope, source, q)
 *   POST — create an EXPLICIT memory (user-authored: manual form).
 *          The engine enforces origin + secret guards (spec §15).
 */

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";

import {
  createMemoryItem,
  listMemoryItems,
} from "@/server/memory/engine";
import {
  createMemoryItemSchema,
  MEMORY_SCOPES,
  MEMORY_STATUSES,
  MEMORY_TYPES,
} from "@/server/memory/types";
import type { MemoryScope, MemoryStatus, MemoryType } from "@/server/memory/types";

export const dynamic = "force-dynamic";

function csv<T extends string>(value: string | null, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const list = value
    .split(",")
    .map((v) => v.trim())
    .filter((v): v is T => (allowed as readonly string[]).includes(v));
  return list.length > 0 ? list : undefined;
}

export const GET = withApi(async (req) => {
  const url = new URL(req.url);
  const items = await listMemoryItems({
    status: csv<MemoryStatus>(url.searchParams.get("status"), MEMORY_STATUSES),
    type: csv<MemoryType>(url.searchParams.get("type"), MEMORY_TYPES),
    scope: csv<MemoryScope>(url.searchParams.get("scope"), MEMORY_SCOPES),
    source: url.searchParams.get("source") === "inferred" || url.searchParams.get("source") === "explicit"
      ? url.searchParams.get("source") as "explicit" | "inferred"
      : undefined,
    q: url.searchParams.get("q")?.slice(0, 200) || undefined,
  });
  return jsonOk({ items });
});

export const POST = withApi(async (req) => {
  const body = createMemoryItemSchema.parse(await req.json());
  const item = await createMemoryItem({
    type: body.type,
    title: body.title,
    content: body.content,
    scope: body.scope,
    scopeRef: body.scopeRef ?? null,
    evidenceRefs: body.evidenceRefs ?? [],
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    source: "explicit",
    origin: "manual",
    confidence: 1,
  });
  return jsonOk({ item }, { status: 201 });
});
