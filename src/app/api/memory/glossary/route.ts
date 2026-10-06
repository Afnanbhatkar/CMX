/**
 * /api/memory/glossary — Phase 9.5 Personal Glossary (spec §8).
 *   GET    — list entries.
 *   POST   — upsert { term, definition, aliases? } (user-editable).
 *   DELETE — ?id=<entryId>.
 */

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { z } from "zod";

import {
  deleteGlossaryEntry,
  listGlossary,
  upsertGlossaryEntry,
} from "@/server/memory/engine";

export const dynamic = "force-dynamic";

const upsertSchema = z.object({
  term: z.string().min(1).max(200),
  definition: z.string().min(1).max(2000),
  aliases: z.array(z.string().min(1).max(200)).max(10).optional(),
});

export const GET = withApi(async () => {
  const entries = await listGlossary();
  return jsonOk({ entries });
});

export const POST = withApi(async (req) => {
  const body = upsertSchema.parse(await req.json());
  const entry = await upsertGlossaryEntry(body);
  return jsonOk({ entry }, { status: 201 });
});

export const DELETE = withApi(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return jsonOk({ deleted: false, note: "missing id" }, { status: 400 });
  const result = await deleteGlossaryEntry(id);
  return jsonOk({ deleted: true, ...result });
});
