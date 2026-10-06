/**
 * /api/memory/preferences — Phase 9.5 adaptive depth + incognito defaults
 * (spec §9 + §13). Stored in UserProfile.prefsJson (never credentials).
 * Preferences never suppress security/correctness/data-loss warnings or
 * approval requirements — UNSUPPRESSABLE_WARNING_KINDS is a hard constant.
 */

import { withApi } from "@/server/api/with-api";
import { jsonOk } from "@/server/api/envelope";
import { z } from "zod";

import {
  getMemoryPreferences,
  updateMemoryPreferences,
} from "@/server/memory/engine";
import {
  memoryPreferencesSchema,
  UNSUPPRESSABLE_WARNING_KINDS,
} from "@/server/memory/types";

export const dynamic = "force-dynamic";

const patchSchema = memoryPreferencesSchema.partial();

export const GET = withApi(async () => {
  const preferences = await getMemoryPreferences();
  return jsonOk({ preferences, unsuppressable: UNSUPPRESSABLE_WARNING_KINDS });
});

export const PATCH = withApi(async (req) => {
  const body = patchSchema.parse(await req.json());
  const preferences = await updateMemoryPreferences(body);
  return jsonOk({ preferences });
});
