import { createEvent, type CodeMindEvent } from "./types";
import { logError } from "@/server/security/logger";

/**
 * CodeMind X V2 — process-wide typed event bus (Phase 3, spec §5/§7).
 *
 * Zero-dependency pub/sub with a bounded in-memory ring buffer (last 200
 * events) used for SSE replay. The singleton lives on `globalThis` so it
 * survives Next.js dev-server module reloads (same pattern as src/lib/db.ts).
 *
 * Contracts:
 * - `publish` NEVER throws because of a subscriber: listener exceptions are
 *   caught + logged, so a broken consumer cannot break a job run;
 * - `subscribe` returns an unsubscribe function;
 * - `recent(limit)` returns up to the last `limit` events (replay support);
 * - a single process-wide STREAM_HEARTBEAT is published every 15 s (timer
 *   starts with the bus) so SSE clients get liveness frames and replay shows
 *   recent heartbeats even before a given client connected.
 *
 * Redis pub/sub is [PLANNED] (CAPABILITIES.md) — this in-process bus is the
 * documented local runtime.
 */

const RING_CAPACITY = 200;
const HEARTBEAT_INTERVAL_MS = 15_000;

export type EventListener = (event: CodeMindEvent) => void;

class EventBus {
  private readonly listeners = new Set<EventListener>();
  private ring: CodeMindEvent[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** Fan out one event. Subscriber exceptions never break the publisher. */
  publish(event: CodeMindEvent): void {
    this.ring.push(event);
    if (this.ring.length > RING_CAPACITY) {
      this.ring.splice(0, this.ring.length - RING_CAPACITY);
    }

    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        // One broken subscriber must not affect the publisher or the others.
        logError("event-bus: listener threw", {
          eventType: event.type,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      }
    }
  }

  /** Register a listener; returns its unsubscribe function. */
  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    this.ensureHeartbeat();
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Last `limit` events (oldest first) for SSE replay. */
  recent(limit: number = RING_CAPACITY): CodeMindEvent[] {
    const start = Math.max(0, this.ring.length - Math.max(0, limit));
    return this.ring.slice(start);
  }

  /** Single process-wide liveness heartbeat (starts with the bus). */
  private ensureHeartbeat(): void {
    if (this.heartbeatTimer !== null) return;
    this.heartbeatTimer = setInterval(() => {
      this.publish(createEvent({ type: "STREAM_HEARTBEAT" }));
    }, HEARTBEAT_INTERVAL_MS);
  }
}

// Survive dev-server HMR: keep one bus per process on globalThis.
const globalForBus = globalThis as unknown as { __cmxEventBus?: EventBus };

export function getEventBus(): EventBus {
  if (!globalForBus.__cmxEventBus) {
    globalForBus.__cmxEventBus = new EventBus();
  }
  return globalForBus.__cmxEventBus;
}

/** Publish an event to every current subscriber (+ ring buffer). */
export function publish(event: CodeMindEvent): void {
  getEventBus().publish(event);
}

/** Subscribe to the live stream; returns the unsubscribe function. */
export function subscribe(listener: EventListener): () => void {
  return getEventBus().subscribe(listener);
}

/** Replay helper: the most recent events, oldest first. */
export function recent(limit?: number): CodeMindEvent[] {
  return getEventBus().recent(limit);
}
