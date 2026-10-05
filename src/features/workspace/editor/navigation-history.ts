"use client";

/**
 * CodeMind X V2 — navigation history (V2.1 ADDITIONS §C).
 *
 * VS Code-style editor navigation memory:
 * - back / forward stacks over REAL navigation events (every successful
 *   EditorNavigationService.open lands here);
 * - bookmarks (persisted to localStorage, versioned, additive);
 * - recent locations (deduplicated, capped);
 * - go-to-test hooks: jump from a source file to its REAL test file (found
 *   in the actual workspace tree — never fabricated when none exists).
 *
 * The service subscribes to the EditorNavigationService and routes its own
 * back/forward jumps through it too — one navigation pipeline, no bypasses.
 */

import { editorNavigation } from "../editor-navigation";
import type { EditorNavigationPayload } from "../types";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export interface HistoryLocation {
  path: string;
  line?: number;
  column?: number;
  ts: number;
  /** Why this entry exists (navigation reason / tool). */
  reason?: string;
}

const MAX_BACK = 100;
const MAX_RECENT = 30;
const BOOKMARKS_KEY = "cmx-navigation-bookmarks-v1";
const MAX_BOOKMARKS = 100;

export type HistoryListener = () => void;

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

class NavigationHistoryServiceImpl {
  private backStack: HistoryLocation[] = [];
  private forwardStack: HistoryLocation[] = [];
  private current: HistoryLocation | null = null;
  private recent: HistoryLocation[] = [];
  private bookmarks: HistoryLocation[] = [];
  private listeners = new Set<HistoryListener>();
  /** Suppress recording while WE navigate (back/forward). */
  private internalNavigation = false;
  private lastRecordAt = 0;

  constructor() {
    this.loadBookmarks();
    editorNavigation.subscribe((payload) => this.onNavigation(payload));
  }

  /* ---------------- recording ---------------- */

  private onNavigation(payload: EditorNavigationPayload): void {
    if (this.internalNavigation) {
      this.internalNavigation = false;
      return;
    }
    const now = Date.now();
    // Coalesce rapid successive opens of the same target (double events).
    if (
      this.current &&
      this.current.path === payload.filePath &&
      this.current.line === (payload.line ?? undefined) &&
      now - this.lastRecordAt < 300
    ) {
      return;
    }
    this.lastRecordAt = now;
    const previous = this.current;
    this.current = {
      path: payload.filePath,
      line: payload.line ?? undefined,
      column: payload.column ?? undefined,
      ts: now,
      reason: payload.navigationReason,
    };
    if (previous) {
      this.backStack.push(previous);
      if (this.backStack.length > MAX_BACK) this.backStack.shift();
    }
    this.forwardStack = [];
    this.pushRecent(this.current);
    this.notify();
  }

  private pushRecent(entry: HistoryLocation): void {
    this.recent = [
      entry,
      ...this.recent.filter(
        (r) => !(r.path === entry.path && r.line === entry.line),
      ),
    ].slice(0, MAX_RECENT);
  }

  /* ---------------- back / forward ---------------- */

  canGoBack(): boolean {
    return this.backStack.length > 0;
  }

  canGoForward(): boolean {
    return this.forwardStack.length > 0;
  }

  back(): void {
    const target = this.backStack.pop();
    if (!target) return;
    if (this.current) this.forwardStack.push(this.current);
    this.jump(target, "back");
  }

  forward(): void {
    const target = this.forwardStack.pop();
    if (!target) return;
    if (this.current) this.backStack.push(this.current);
    this.jump(target, "forward");
  }

  private async jump(target: HistoryLocation, direction: "back" | "forward"): Promise<void> {
    this.current = target;
    this.internalNavigation = true;
    const result = await editorNavigation.openRange(
      target.path,
      target.line ?? 1,
      target.line ?? 1,
      "manual",
    );
    if (!result.ok) {
      // The jump failed — swallow the internal flag so future events record.
      this.internalNavigation = false;
    }
    this.pushRecent(target);
    this.notify();
    void direction;
  }

  /* ---------------- recent locations ---------------- */

  recentLocations(): HistoryLocation[] {
    return [...this.recent];
  }

  /* ---------------- bookmarks ---------------- */

  getBookmarks(): HistoryLocation[] {
    return [...this.bookmarks];
  }

  isBookmarked(path: string, line?: number): boolean {
    return this.bookmarks.some(
      (b) => b.path === path && (line === undefined || b.line === undefined || b.line === line),
    );
  }

  toggleBookmark(path: string, line?: number): boolean {
    const index = this.bookmarks.findIndex(
      (b) => b.path === path && (line === undefined || b.line === undefined || b.line === line),
    );
    if (index >= 0) {
      this.bookmarks.splice(index, 1);
      this.saveBookmarks();
      this.notify();
      return false;
    }
    this.bookmarks.unshift({ path, line, ts: Date.now(), reason: "bookmark" });
    if (this.bookmarks.length > MAX_BOOKMARKS) this.bookmarks.pop();
    this.saveBookmarks();
    this.notify();
    return true;
  }

  removeBookmark(path: string, line?: number): void {
    this.bookmarks = this.bookmarks.filter(
      (b) => !(b.path === path && (line === undefined || b.line === line)),
    );
    this.saveBookmarks();
    this.notify();
  }

  private loadBookmarks(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(BOOKMARKS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as HistoryLocation[];
      if (Array.isArray(parsed)) {
        this.bookmarks = parsed
          .filter((b) => typeof b?.path === "string" && b.path)
          .slice(0, MAX_BOOKMARKS);
      }
    } catch {
      // corrupt/absent state — start clean, never throw
    }
  }

  private saveBookmarks(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(this.bookmarks));
    } catch {
      // best-effort persistence
    }
  }

  /* ---------------- go-to-test hooks ---------------- */

  /**
   * Candidate test-file paths for a source file — REAL conventions:
   *   foo.ts → foo.test.ts / foo.spec.ts / __tests__/foo.test.ts
   *   src/a/b.ts → src/a/__tests__/b.test.ts, tests/a/b.test.ts, test/...
   */
  candidateTestPaths(path: string): string[] {
    const lastSlash = path.lastIndexOf("/");
    const dir = lastSlash === -1 ? "" : path.slice(0, lastSlash);
    const file = lastSlash === -1 ? path : path.slice(lastSlash + 1);
    const dot = file.lastIndexOf(".");
    const base = dot === -1 ? file : file.slice(0, dot);
    const ext = dot === -1 ? "" : file.slice(dot);
    const candidates = [
      `${dir ? `${dir}/` : ""}${base}.test${ext}`,
      `${dir ? `${dir}/` : ""}${base}.spec${ext}`,
      `${dir ? `${dir}/` : ""}__tests__/${base}.test${ext}`,
      `tests/${dir ? `${dir}/` : ""}${base}.test${ext}`,
      `test/${dir ? `${dir}/` : ""}${base}.test${ext}`,
    ];
    return [...new Set(candidates)];
  }

  /**
   * go-to-test: verify candidates against the REAL tree, then open the first
   * that exists. Returns the opened path or null (no test file — honest).
   */
  async goToTest(path: string): Promise<{ ok: boolean; opened?: string; reason?: string }> {
    const candidates = this.candidateTestPaths(path);
    try {
      const res = await fetch("/api/repository/tree", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; tree?: unknown }
        | null;
      if (!res.ok || !data?.ok) {
        return { ok: false, reason: "The workspace tree is unavailable right now." };
      }
      const paths = new Set<string>();
      const walk = (nodes: unknown): void => {
        if (!Array.isArray(nodes)) return;
        for (const node of nodes as Array<{ path?: string; type?: string; children?: unknown }>) {
          if (typeof node?.path !== "string") continue;
          if (node.type === "file") paths.add(node.path);
          else walk(node.children);
        }
      };
      walk(data.tree);
      const existing = candidates.find((candidate) => paths.has(candidate));
      if (!existing) {
        return { ok: false, reason: "No test file found for this file in the workspace." };
      }
      const result = await editorNavigation.openFile(existing, "testing");
      return result.ok
        ? { ok: true, opened: existing }
        : { ok: false, reason: result.message };
    } catch {
      return { ok: false, reason: "The workspace tree is unreachable right now." };
    }
  }

  /* ---------------- subscription ---------------- */

  subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // broken subscriber must not break others
      }
    }
  }
}

/** App-wide singleton. */
export const navigationHistory = new NavigationHistoryServiceImpl();
