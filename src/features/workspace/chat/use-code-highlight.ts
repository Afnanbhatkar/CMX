"use client";

/**
 * CodeMind X V2 — Phase 8.5 worker-based code highlighting hook.
 *
 * Spawns ONE shared highlight worker lazily; long code blocks send their
 * text off-thread and render typed token runs as React nodes. Falls back
 * to plain text when Workers are unavailable, the language is unsupported,
 * or the response never arrives (the code is ALWAYS visible either way —
 * highlighting is an enhancement, never a gate).
 */

import { useEffect, useRef, useState } from "react";

import type { HighlightResponse, HighlightToken } from "./highlight.worker";

export interface CodeHighlightState {
  /** Token runs per line; null = render plain. */
  lines: HighlightToken[][] | null;
}

const MIN_LINES_FOR_WORKER = 24;

export function useCodeHighlight(
  code: string,
  language: string | undefined,
  lineCount: number,
): CodeHighlightState {
  /**
   * The result carries the code it was produced for — the derived value
   * below only exposes tokens that belong to the CURRENT text (stale
   * responses render as plain text, never mismatched colors).
   */
  const [result, setResult] = useState<{ code: string; lines: HighlightToken[][] | null } | null>(
    null,
  );
  const workerRef = useRef<Worker | null>(null);
  const requestSeq = useRef(0);

  const enabled = lineCount >= MIN_LINES_FOR_WORKER && Boolean(language);

  useEffect(() => {
    if (!enabled) return; // short blocks: plain render is cheap — no worker
    let cancelled = false;
    const requestId = ++requestSeq.current;
    try {
      if (!workerRef.current) {
        workerRef.current = new Worker(
          new URL("./highlight.worker.ts", import.meta.url),
        );
      }
      const worker = workerRef.current;
      const onMessage = (event: MessageEvent<HighlightResponse>) => {
        if (cancelled || event.data.id !== requestId) return;
        worker.removeEventListener("message", onMessage);
        setResult({ code, lines: event.data.lines });
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ id: requestId, code, language });
      return () => {
        cancelled = true;
        worker.removeEventListener("message", onMessage);
      };
    } catch {
      // Worker unavailable in this context — plain render (honest fallback).
      return;
    }
  }, [code, language, enabled]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const lines = result && result.code === code ? result.lines : null;
  return { lines };
}
