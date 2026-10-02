"use client";

/**
 * CodeMind X V2 — EditorNavigationService (spec §28).
 *
 * THE single mechanism for opening a file in the repository workspace.
 * Consumers: chat file references, attachments, search results, command
 * palette, (later) architecture/security/test/git/terminal surfaces.
 *
 * Safety handling (spec §28):
 * - empty path → rejected
 * - file not found / outside the workspace tree → not-found
 * - binary or oversized file → explicit typed result
 * - network/backend failure → load-failed
 *
 * This service intentionally does NOT import the store: subscribers decide
 * what to do with a successful navigation (the repository workspace opens
 * the tab). This keeps the service replaceable and dependency-free.
 */

import { toast } from "@/hooks/use-toast";
import type {
  EditorNavigationPayload,
  EditorNavigationResult,
} from "./types";

type NavigationListener = (payload: EditorNavigationPayload) => void;

class EditorNavigationServiceImpl {
  private listeners = new Set<NavigationListener>();

  subscribe(listener: NavigationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

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

      // Success — notify the repository workspace.
      for (const listener of this.listeners) {
        try {
          listener({ ...payload, filePath, line });
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
