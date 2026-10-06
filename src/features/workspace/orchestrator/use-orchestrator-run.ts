"use client";

/**
 * CodeMind X V2 — orchestrator run polling hook (Phase 9 UI).
 *
 * Polls GET /api/orchestrator/runs/[id] while the run is in an active
 * state. High-level trace ONLY — the UI never renders model reasoning
 * (spec §6).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { OrchestrationRunState } from "@/server/orchestrator/contracts";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting-approval"]);
const POLL_INTERVAL_MS = 900;

export function useOrchestratorRun(runPublicId: string | null) {
  const [state, setState] = useState<OrchestrationRunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/orchestrator/runs/${id}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      const json = (await res.json()) as { data: OrchestrationRunState };
      setState(json.data);
      setError(null);
      return json.data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "poll failed");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!runPublicId) {
      setState(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const loop = async () => {
      const next = await poll(runPublicId);
      if (cancelled) return;
      if (next && ACTIVE_STATUSES.has(next.status)) {
        timerRef.current = setTimeout(loop, POLL_INTERVAL_MS);
      }
    };
    void loop();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [runPublicId, poll]);

  const refresh = useCallback(async () => {
    if (runPublicId) await poll(runPublicId);
  }, [runPublicId, poll]);

  return { state, error, refresh };
}
