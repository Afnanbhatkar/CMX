import { z } from "zod";

/**
 * CodeMind X V2 — shared zod schemas for the versioned API (Phase 3, spec §4).
 *
 * All inputs to API routes are validated here (or in route-local schemas built
 * from these pieces). Zod v4 default object behavior STRIPS unknown keys
 * without failing — that is exactly the "passthrough context, strict unknown
 * keys stripped" semantics the API contract wants.
 */

/** GET ?path= — workspace-relative path (file reads, future file APIs). */
export const pathQuerySchema = z.object({
  path: z.string().min(1).max(512),
});

/** GET ?q=&limit= — filename search over the real workspace tree. */
export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Workspace context the frontend attaches to assistant turns (all optional). */
export const assistantContextSchema = z.object({
  repository: z.string().max(128).optional(),
  branch: z.string().max(128).optional(),
  activeFile: z.string().max(512).optional(),
});

/** One conversation turn. Same wire shape POST /api/ai/chat uses today. */
export const assistantMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8_000),
});

/**
 * Assistant request (POST /api/assistant):
 * - `message`  → single-turn form: { message, context? };
 * - `messages` → history form, identical to the legacy /api/ai/chat payload,
 *   so the extracted service keeps serving both surfaces unchanged.
 * `conversationId` is an optional client-side uuid-ish correlation id.
 */
export const assistantRequestSchema = z
  .object({
    message: z.string().min(1).max(8_000).optional(),
    messages: z.array(assistantMessageSchema).min(1).max(30).optional(),
    conversationId: z
      .string()
      .regex(/^[0-9a-fA-F-]{8,64}$/, "Must look like a UUID.")
      .optional(),
    context: assistantContextSchema.optional(),
  })
  .refine(
    (data) =>
      typeof data.message === "string" ||
      (Array.isArray(data.messages) && data.messages.length > 0),
    { message: "Provide 'message' or a non-empty 'messages' array." },
  );
