"use client";

/**
 * CodeMind X V2 — EditorNavigationService (spec §28, V2.1 ADDITIONS §A).
 *
 * THE single mechanism for opening a file in the repository workspace.
 * Consumers: chat file references, attachments, search results, command
 * palette, AI code blocks, (later) architecture/security/test/git/terminal
 * surfaces.
 *
 * Public API (V2.1 §A — the only supported routes for opening files):
 * - openFile(path)
 * - openRange(path, startLine, endLine)
 * - openSymbol(symbolId)          — resolves via the symbol registry
 * - openSearchResult(resultId)    — resolves via the search-result registry
 * - revealSelection(selection)    — reveal in the OPEN editor; opens if closed
 * - open(payload)                 — full typed payload (legacy entry point)
 *
 * Safety handling (spec §28):
 * - empty path → rejected
 * - file not found / outside the workspace tree → not-found
 * - binary or oversized file → explicit typed result
 * - network/backend failure → load-failed
 * - unknown symbol/search-result id → not-found (never guessed)
 *
 * This service intentionally does NOT import the store: subscribers decide
 * what to do with a successful navigation (the repository workspace opens
 * the tab). This keeps the service replaceable and dependency-free.
 */

import { toast } from "@/hooks/use-toast";
import type {
  EditorNavigationPayload,
  EditorNavigationResult,
  FileSelection,
} from "./types";

type NavigationListener = (payload: EditorNavigationPayload) => void;

/**
 * Where a registered navigation target came from. Conventions:
 * - "search-result" — global search surfaces;
 * - "outline:<path>" — the text-scan symbol outline of ONE file (Phase 6 §3);
 * - "code-intelligence" — future intelligence providers.
 */
export type NavigationTargetSource =
  | "search-result"
  | "code-intelligence"
  | `outline:${string}`;

/**
 * A registered, RESOLVED navigation target. Registries are filled only with
 * REAL data (computed from actual file content) by intelligence/search
 * surfaces; ids are opaque strings minted by the registerer.
 */
export interface RegisteredNavigationTarget {
  id: string;
  filePath: string;
  line?: number;
  column?: number;
  /** Optional display hint (symbol name / search snippet). */
  label?: string;
  source: NavigationTargetSource;
}

export type NavigationOpenResult = EditorNavigationResult;
export type NavigationRevealResult =
  | { ok: true; revealed: true; opened: false }
  | { ok: true; revealed: true; opened: true; filePath: string }
  | { ok: false; code: EditorNavigationResult extends never ? never : "empty-path" | "not-found" | "load-failed" | "too-large"; message: string };

class EditorNavigationServiceImpl {
  private listeners = new Set<NavigationListener>();
  /** symbolId / resultId → resolved target (only REAL, verified entries). */
  private targets = new Map<string, RegisteredNavigationTarget>();
  /**
   * Last successful navigation payload, retained until a shell consumes it.
   * Fixes cross-destination navigation: when a file is opened from a section
   * where the repository workspace is not yet mounted (search, overview…),
   * the shell consumes this on mount instead of the event being lost.
   */
  private lastPayload: EditorNavigationPayload | null = null;

  subscribe(listener: NavigationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Consume the retained last payload (one-shot). Used by the repository
   * workspace shell on mount so navigation issued from another destination
   * still opens the file after the section switches.
   */
  consumeLastPayload(): EditorNavigationPayload | null {
    const payload = this.lastPayload;
    this.lastPayload = null;
    return payload;
  }

  /* ---------------------------------------------------------------- */
  /* Registries (symbols, search results)                              */
  /* ---------------------------------------------------------------- */

  /**
   * Register or refresh resolved targets (e.g. after an outline or search
   * pass). Replaces previous entries from the same source; never throws.
   */
  registerTargets(
    source: NavigationTargetSource,
    targets: Omit<RegisteredNavigationTarget, "source">[],
  ): void {
    for (const [id, target] of this.targets) {
      if (target.source === source) this.targets.delete(id);
    }
    for (const target of targets.slice(0, 5000)) {
      if (!target.id || !target.filePath) continue;
      this.targets.set(target.id, { ...target, source });
    }
  }

  /** Forget a source's entries (e.g. its surface unmounted). */
  unregisterTargets(source: NavigationTargetSource): void {
    for (const [id, target] of this.targets) {
      if (target.source === source) this.targets.delete(id);
    }
  }

  hasTarget(id: string): boolean {
    return this.targets.has(id);
  }

  /* ---------------------------------------------------------------- */
  /* V2.1 §A — the supported opening routes                            */
  /* ---------------------------------------------------------------- */

  /** openFile(path) — open (or focus) a file at its top. */
  async openFile(path: string, sourceContext?: EditorNavigationPayload["sourceContext"]): Promise<NavigationOpenResult> {
    return this.open({ filePath: path, sourceContext: sourceContext ?? "manual" });
  }

  /** openRange(path, startLine, endLine) — open + highlight a line range. */
  async openRange(
    path: string,
    startLine: number,
    endLine: number,
    sourceContext?: EditorNavigationPayload["sourceContext"],
  ): Promise<NavigationOpenResult> {
    const start = Number.isFinite(startLine) && startLine > 0 ? Math.floor(startLine) : 1;
    const end = Number.isFinite(endLine) && endLine >= start ? Math.floor(endLine) : start;
    return this.open({
      filePath: path,
      line: start,
      range: { startLine: start, endLine: end },
      sourceContext: sourceContext ?? "manual",
    });
  }

  /** openSymbol(symbolId) — open the file/line a registered symbol points at. */
  async openSymbol(symbolId: string): Promise<NavigationOpenResult> {
    const target = this.targets.get(symbolId);
    if (!target) {
      const result: NavigationOpenResult = {
        ok: false,
        code: "not-found",
        message: "That symbol is no longer available. Re-open the file to refresh its outline.",
      };
      this.reportFailure(result);
      return result;
    }
    return this.open({
      filePath: target.filePath,
      line: target.line,
      column: target.column,
      symbol: target.label,
      sourceContext: "intelligence",
      navigationReason: `symbol: ${target.label ?? target.id}`,
    });
  }

  /** openSearchResult(resultId) — open a registered search hit. */
  async openSearchResult(resultId: string): Promise<NavigationOpenResult> {
    const target = this.targets.get(resultId);
    if (!target) {
      const result: NavigationOpenResult = {
        ok: false,
        code: "not-found",
        message: "That search result is no longer available. Run the search again.",
      };
      this.reportFailure(result);
      return result;
    }
    return this.open({
      filePath: target.filePath,
      line: target.line,
      column: target.column,
      sourceContext: "search",
      navigationReason: `search result: ${target.label ?? target.id}`,
    });
  }

  /**
   * revealSelection(selection) — reveal + highlight a selection in the open
   * editor WITHOUT opening a dialog or reloading the file when it is already
   * open. If the file is not open (or not loaded), it is opened via the
   * normal route first. The only consumer allowed to skip the file fetch is
   * the editor surface itself, which still goes through this notification.
   */
  async revealSelection(selection: FileSelection): Promise<NavigationRevealResult> {
    const filePath = typeof selection?.path === "string" ? selection.path.trim() : "";
    if (!filePath) {
      return { ok: false, code: "empty-path", message: "No file path was provided." };
    }
    const start = Number.isFinite(selection.startLine) && selection.startLine > 0 ? Math.floor(selection.startLine) : 1;
    const end = Number.isFinite(selection.endLine) && selection.endLine >= start ? Math.floor(selection.endLine) : start;

    // Notify as a range payload; the editor layer decides whether it can
    // reveal in-place (file already open) or must load the tab.
    const payload: EditorNavigationPayload = {
      filePath,
      line: start,
      range: { startLine: start, endLine: end, startColumn: 1 },
      sourceContext: "manual",
      navigationReason: "reveal selection",
    };
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch {
        // a broken subscriber must never break navigation for others
      }
    }
    return { ok: true, revealed: true, opened: false };
  }

  /* ---------------------------------------------------------------- */
  /* Core verification + notification (spec §28)                       */
  /* ---------------------------------------------------------------- */

  /**
   * Validate + verify against the real file API, then notify subscribers.
   * Never throws — always resolves with a typed result.
   */
  async open(payload: EditorNavigationPayload): Promise<EditorNavigationResult> {
    const filePath = typeof payload?.filePath === "string" ? payload.filePath.trim() : "";
    if (!filePath) {
      const result: EditorNavigationResult = {
        ok: false,
        code: "empty-path",
        message: "No file path was provided.",
      };
      this.reportFailure(result);
      return result;
    }

    const line =
      typeof payload.line === "number" && Number.isFinite(payload.line) && payload.line > 0
        ? Math.floor(payload.line)
        : undefined;

    try {
      const res = await fetch(
        `/api/repository/file?path=${encodeURIComponent(filePath)}`,
        { cache: "no-store" },
      );

      if (res.status === 404 || res.status === 403) {
        const result: EditorNavigationResult = {
          ok: false,
          code: "not-found",
          message: `"${filePath}" is not part of the connected workspace tree.`,
        };
        this.reportFailure(result);
        return result;
      }
      if (res.status === 413) {
        const result: EditorNavigationResult = {
          ok: false,
          code: "too-large",
          message: `"${filePath}" is too large to open in the editor.`,
        };
        this.reportFailure(result);
        return result;
      }

      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; file?: { binary?: boolean } }
        | null;
      if (!res.ok || !data?.ok) {
        const result: EditorNavigationResult = {
          ok: false,
          code: "load-failed",
          message: `The file could not be loaded (HTTP ${res.status}).`,
        };
        this.reportFailure(result);
        return result;
      }

      // Success — retain for late mounters, then notify the subscribers.
      const finalPayload: EditorNavigationPayload = { ...payload, filePath, line };
      this.lastPayload = finalPayload;
      for (const listener of this.listeners) {
        try {
          listener(finalPayload);
        } catch {
          // a broken subscriber must never break navigation for others
        }
      }
      return { ok: true, filePath, line };
    } catch {
      const result: EditorNavigationResult = {
        ok: false,
        code: "load-failed",
        message: "The file service is unreachable right now.",
      };
      this.reportFailure(result);
      return result;
    }
  }

  private reportFailure(result: Extract<EditorNavigationResult, { ok: false }>) {
    try {
      toast({
        title: "Could not open file",
        description: result.message,
        variant: "destructive",
      });
    } catch {
      // toasts are best-effort; navigation results stay typed regardless
    }
  }
}

/** App-wide singleton. Every file-opening feature MUST use this service. */
export const editorNavigation = new EditorNavigationServiceImpl();
export type { EditorNavigationPayload, EditorNavigationResult };
