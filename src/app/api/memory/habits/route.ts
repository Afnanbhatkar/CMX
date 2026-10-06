/**
 * /api/memory/habits — Phase 9.5 habit-based help (spec §10).
 * Computed from REAL chat history (no hidden counters). A habit only ever
 * PROPOSES a reusable workflow — it never silently changes autonomy.
 */

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";

import { getHabitSignals } from "@/server/memory/engine";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const habits = await getHabitSignals();
  return jsonOk({ habits });
});
