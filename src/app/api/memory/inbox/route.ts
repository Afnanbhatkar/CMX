/**
 * /api/memory/inbox — Phase 9.5 Memory Inbox (spec §6).
 *   GET  — proposed (inferred) items awaiting confirmation.
 *   POST — { id, decision: "accept" | "reject" }.
 *          Inferred memory NEVER activates without this explicit action.
 */

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { z } from "zod";

import { decideInboxItem, listInbox } from "@/server/memory/engine";

export const dynamic = "force-dynamic";

const decideSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["accept", "reject"]),
});

export const GET = withApi(async () => {
  const items = await listInbox();
  return jsonOk({ items });
});

export const POST = withApi(async (req) => {
  const body = decideSchema.parse(await req.json());
  const item = await decideInboxItem(body.id, body.decision);
  return jsonOk({ item });
});
