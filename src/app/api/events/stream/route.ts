import { handleEventStream } from "@/server/events/sse";

/**
 * GET /api/events/stream — alias of GET /api/events (spec-friendly path).
 * Same handler, same contract: replay, live typed events, heartbeats.
 */
export const dynamic = "force-dynamic";

export const GET = handleEventStream;
