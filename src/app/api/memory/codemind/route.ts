/**
 * /api/memory/codemind — Phase 9.5 CODEMIND.md recognition (spec §5).
 *   GET  — parse the workspace CODEMIND.md: does it exist, does it carry the
 *          standard heading, and which rule lines were found (real anchors).
 *   POST — sync the parsed rules into explicit project-rule memories
 *          (idempotent — already-saved rules are skipped). This is the ONLY
 *          path by which a repository file becomes memory, by user action,
 *          because CODEMIND.md's contract is "user-authored project rules".
 *          README.md is never read by this engine.
 */

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { db } from "@/lib/db";

import { parseCodemindMd, syncCodemindRules } from "@/server/memory/codemind-md";
import { createMemoryItem } from "@/server/memory/engine";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const parsed = await parseCodemindMd();
  // Which rules are already saved (idempotency visibility for the UI).
  const saved = await db.memoryItem.findMany({
    where: { origin: "codemind-md", status: { in: ["active", "disabled"] } },
    select: { id: true, content: true },
  });
  const savedContents = new Set(saved.map((s) => s.content.toLowerCase()));
  return jsonOk({
    ...parsed,
    savedCount: saved.length,
    rulesWithState: parsed.rules.map((rule) => ({
      ...rule,
      saved: savedContents.has(rule.text.toLowerCase()),
    })),
  });
});

export const POST = withApi(async () => {
  const result = await syncCodemindRules(async ({ title, content, evidenceRef }) => {
    // Idempotency: skip when an identical codemind-md rule already exists.
    const existing = await db.memoryItem.findFirst({
      where: { origin: "codemind-md", content, status: { in: ["active", "disabled"] } },
      select: { id: true },
    });
    if (existing) return null;
    const item = await createMemoryItem({
      type: "project-rule",
      title,
      content,
      scope: "repository",
      scopeRef: null,
      evidenceRefs: [evidenceRef],
      source: "explicit",
      origin: "codemind-md",
      confidence: 1,
    });
    return { id: item.id };
  });
  return jsonOk(result);
});
