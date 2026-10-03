import { handleEventStream } from "@/server/events/sse";

/**
 * GET /api/events — SSE stream of typed CodeMindEvents (Phase 3, spec §6/§7).
 *
 * Raw Response (the withApi envelope is JSON-only). Supports `?replay=1`
 * (ring-buffer replay before the live subscription), typed STREAM_HEARTBEAT
 * liveness frames, and clean teardown on client disconnect. See
 * src/server/events/sse.ts for the full contract.
 */
export const dynamic = "force-dynamic";

export const GET = handleEventStream;
