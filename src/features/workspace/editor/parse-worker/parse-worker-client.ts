"use client";

/**
 * CodeMind X V2 — parse worker client (V2.1 ADDITIONS §B).
 *
 * Main-thread gateway to the code parse worker:
 * - SMALL files (≤ INLINE_SCAN_LIMIT bytes) scan inline on the main thread —
 *   a worker round-trip costs more than the scan itself;
 * - LARGE files ALWAYS go through the worker — the main UI thread never
 *   performs large repository parsing synchronously (V2.1 §B requirement);
 * - worker failure degrades gracefully (inline for medium files, typed
   "unavailable" for huge ones) — never a silent pretend-success;
 * - the engine actually used is tracked + reported so capability badges stay
 *   honest (tree-sitter only when tree-sitter really parsed).
 */

import {
  scanStructure,
  type ScanConstruct,
  type ScanImport,
  type ScanSymbol,
} from "@/lib/code-intel/structure-scanner";
import type { ParseEngine, ParseResponse } from "./code-parse.worker";

export type { ParseEngine };
export type { ScanSymbol, ScanImport, ScanConstruct };

/** Files up to this size scan inline (main thread) — measured, not guessed. */
export const INLINE_SCAN_LIMIT = 32 * 1024;
/** Files above this size are NEVER scanned on the main thread. */
export const MAIN_THREAD_SCAN_CEILING = 200 * 1024;

export interface ParseResult {
  ok: boolean;
  engine: ParseEngine;
  symbols: ScanSymbol[];
  imports: ScanImport[];
  constructs: ScanConstruct[];
  parseMs: number;
  /** Where the parse actually ran. */
  thread: "main" | "worker";
  error?: string;
}

type EngineListener = (engine: ParseEngine) => void;

class ParseWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<
    string,
    { resolve: (result: ParseResult) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private nextId = 0;
  private lastEngine: ParseEngine = "unavailable";
  private engineListeners = new Set<EngineListener>();

  /** The engine most recently used for symbol extraction (badge source). */
  getEngine(): ParseEngine {
    return this.lastEngine;
  }

  onEngineChange(listener: EngineListener): () => void {
    this.engineListeners.add(listener);
    return () => {
      this.engineListeners.delete(listener);
    };
  }

  private setEngine(engine: ParseEngine): void {
    if (this.lastEngine === engine) return;
    this.lastEngine = engine;
    for (const listener of this.engineListeners) {
      try {
        listener(engine);
      } catch {
        // a broken subscriber must never break parsing for others
      }
    }
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (typeof window === "undefined") return null;
    try {
      this.worker = new Worker(
        new URL("./code-parse.worker.ts", import.meta.url),
        { type: "module", name: "cmx-code-parse" },
      );
      this.worker.onmessage = (event: MessageEvent<ParseResponse>) => {
        const pending = this.pending.get(event.data?.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(event.data.id);
        this.setEngine(event.data.engine);
        pending.resolve({
          ok: event.data.ok,
          engine: event.data.engine,
          symbols: event.data.symbols ?? [],
          imports: event.data.imports ?? [],
          constructs: event.data.constructs ?? [],
          parseMs: event.data.parseMs ?? 0,
          thread: "worker",
          error: event.data.error,
        });
      };
      this.worker.onerror = () => {
        // Worker died — fail all pending with engine unavailable; next call
        // retries creating a fresh worker.
        for (const [, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.resolve({
            ok: false,
            engine: "unavailable",
            symbols: [],
            imports: [],
            constructs: [],
            parseMs: 0,
            thread: "worker",
            error: "parse worker crashed",
          });
        }
        this.pending.clear();
        this.worker = null;
      };
      return this.worker;
    } catch {
      this.worker = null;
      return null;
    }
  }

  /**
   * Parse one file's structure. Never throws. Timeout-bounded; falls back to
   * the inline scan only within the main-thread ceiling.
   */
  parse(input: {
    path: string;
    content: string;
    languageId: string;
    /** Override the size policy (tests). */
    forceWorker?: boolean;
  }): Promise<ParseResult> {
    const bytes = input.content.length;
    const started = performance.now();

    const inlineScan = (): ParseResult => {
      const result = scanStructure(input.content, input.languageId);
      this.setEngine("structural-scan");
      return {
        ok: true,
        engine: "structural-scan",
        symbols: result.symbols,
        imports: result.imports,
        constructs: result.constructs,
        parseMs: Math.round((performance.now() - started) * 100) / 100,
        thread: "main",
      };
    };

    if (!input.forceWorker && bytes <= INLINE_SCAN_LIMIT) {
      return Promise.resolve(inlineScan());
    }

    const worker = this.ensureWorker();
    if (!worker) {
      if (bytes <= MAIN_THREAD_SCAN_CEILING) return Promise.resolve(inlineScan());
      return Promise.resolve({
        ok: false,
        engine: "unavailable",
        symbols: [],
        imports: [],
        constructs: [],
        parseMs: 0,
        thread: "main",
        error: "parse worker unavailable and file exceeds the main-thread scan ceiling",
      });
    }

    const id = `parse-${++this.nextId}`;
    return new Promise<ParseResult>((resolve) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          if (bytes <= MAIN_THREAD_SCAN_CEILING) {
            resolve(inlineScan());
          } else {
            resolve({
              ok: false,
              engine: "unavailable",
              symbols: [],
              imports: [],
              constructs: [],
              parseMs: Math.round((performance.now() - started) * 100) / 100,
              thread: "worker",
              error: "parse timed out",
            });
          }
        },
        8_000,
      );
      this.pending.set(id, { resolve, timer });
      worker.postMessage({
        id,
        type: "scan",
        path: input.path,
        content: input.content,
        languageId: input.languageId,
      });
    });
  }

  /** Terminate the worker (tests / HMR hygiene). */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

/** App-wide singleton. */
export const parseWorkerClient = new ParseWorkerClient();
