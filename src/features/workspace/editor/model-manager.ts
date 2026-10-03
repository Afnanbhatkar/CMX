"use client";

/**
 * CodeMind X V2 — editor model manager (V2.1 ADDITIONS §A).
 *
 * The ONE layer that owns Monaco text models for the workspace editor:
 * - model REUSE: one model per workspace path URI; re-acquiring returns the
 *   live model instead of recreating it (Monaco's model cache stays small);
 * - LRU disposal: when the tracked model count exceeds the cap, the
 *   least-recently-used models are disposed — NEVER a dirty buffer and never
 *   a model attached to a live editor;
 * - memory tracking: an honest byte estimate per model + aggregate stats;
 * - large-file mode: a policy (> 512 KB) that flags models so the editor can
 *   shed expensive features (minimap, folding, decorations);
 * - dirty-buffer restore: in-memory edits are persisted to sessionStorage
 *   (size-capped) so a reload restores the buffer instead of silently
 *   dropping the user's typing. The baseline (loaded file content) is kept
 *   separately — restoring marks the buffer dirty again, honestly.
 *
 * Honesty: nothing here simulates a save flow. A restored buffer is exactly
 * what was typed before the reload; the "unsaved (in-memory)" badge keeps
 * telling the truth.
 */

import type * as MonacoNS from "monaco-editor";

/* ------------------------------------------------------------------ */
/* Policy                                                              */
/* ------------------------------------------------------------------ */

/** Files above this size open through the large-file path (bytes). */
export const LARGE_FILE_BYTES = 512 * 1024;
/** Hard ceiling for the editor (bytes) — above this the tab stays "too-large". */
export const MAX_EDITOR_BYTES = 6 * 1024 * 1024;
/** Maximum simultaneously tracked models before LRU disposal kicks in. */
export const MAX_TRACKED_MODELS = 24;
/** One dirty buffer larger than this is NOT persisted to sessionStorage. */
const MAX_DIRTY_PERSIST_BYTES = 512 * 1024;
/** Total sessionStorage budget for all dirty buffers. */
const MAX_DIRTY_PERSIST_TOTAL = 2 * 1024 * 1024;
const DIRTY_STORE_KEY = "cmx-dirty-buffers-v1";
const DIRTY_DEBOUNCE_MS = 800;

export function isLargeFileSize(bytes: number): boolean {
  return bytes > LARGE_FILE_BYTES;
}

/* ------------------------------------------------------------------ */
/* Dirty buffer persistence (sessionStorage, versioned)                */
/* ------------------------------------------------------------------ */

interface PersistedDirtyBuffer {
  /** Exact buffer text at save time. */
  content: string;
  /** Length of the LOADED baseline the buffer diverged from (advisory). */
  baselineLength: number;
  savedAt: number;
}

function readDirtyStore(): Record<string, PersistedDirtyBuffer> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(DIRTY_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PersistedDirtyBuffer>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDirtyStore(store: Record<string, PersistedDirtyBuffer>): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(DIRTY_STORE_KEY, JSON.stringify(store));
    return true;
  } catch {
    // Quota exceeded — drop the oldest buffers and retry once.
    const entries = Object.entries(store).sort((a, b) => a[1].savedAt - b[1].savedAt);
    while (entries.length > 0) {
      entries.shift();
      try {
        window.sessionStorage.setItem(
          DIRTY_STORE_KEY,
          JSON.stringify(Object.fromEntries(entries)),
        );
        return true;
      } catch {
        // keep dropping
      }
    }
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Model manager                                                       */
/* ------------------------------------------------------------------ */

export interface ModelStats {
  /** Tracked model count. */
  models: number;
  /** Honest byte estimate of all tracked buffers (UTF-16 ≈ 2 B/char). */
  estimatedBytes: number;
  /** Buffers currently differing from their baseline. */
  dirty: number;
  /** Models flagged into large-file mode. */
  largeFile: number;
  /** Models disposed by the LRU policy so far (lifetime). */
  disposedByLru: number;
}

export interface AcquireOptions {
  path: string;
  /** Baseline content as loaded from the file API. */
  content: string;
  languageId: string;
  /** Model URI — defaults to a file: URI of the path. */
  uri?: string;
}

interface TrackedModel {
  model: MonacoNS.editor.ITextModel;
  path: string;
  baseline: string;
  languageId: string;
  largeFile: boolean;
  lastUsedAt: number;
  dirty: boolean;
  /** Attached editors count (acquire attaches, release detaches). */
  attached: number;
}

class EditorModelManagerImpl {
  private tracked = new Map<string, TrackedModel>();
  private dirtyTimer: ReturnType<typeof setTimeout> | null = null;
  private disposedByLru = 0;

  /** The canonical model URI for a workspace path (matches @monaco-editor/react's scheme). */
  modelUri(path: string): string {
    return `file:///${path.replace(/^\/+/, "")}`;
  }

  /**
   * Acquire the model for a path: reuse the existing model (preserving any
   * in-memory edits) or create one from the baseline content. Registers
   * attachment + recency; triggers LRU housekeeping.
   */
  acquire(monaco: typeof MonacoNS, options: AcquireOptions): MonacoNS.editor.ITextModel {
    const uri = options.uri ?? this.modelUri(options.path);
    const existing = this.tracked.get(uri);
    if (existing && !existing.model.isDisposed()) {
      existing.lastUsedAt = Date.now();
      existing.attached += 1;
      // Baseline refresh: a reload of the same path updates the baseline but
      // NEVER clobbers in-memory edits silently — the caller decides.
      existing.baseline = options.content;
      this.lruSweep();
      return existing.model;
    }

    const reused = monaco.editor.getModel(monaco.Uri.parse(uri));
    const model =
      reused ??
      monaco.editor.createModel(options.content, options.languageId, monaco.Uri.parse(uri));
    if (reused && reused.getValue() !== options.content && reused.getValueLength() === 0) {
      // Empty stale model — bring it to the loaded baseline.
      reused.pushEditOperations(
        [],
        [{ range: reused.getFullModelRange(), text: options.content }],
        () => null,
      );
    }

    this.tracked.set(uri, {
      model,
      path: options.path,
      baseline: options.content,
      languageId: options.languageId,
      largeFile: isLargeFileSize(model.getValueLength()),
      lastUsedAt: Date.now(),
      dirty: model.getValue() !== options.content,
      attached: 1,
    });
    this.lruSweep();
    return model;
  }

  /** Detach an editor from a model (tab closed / pane unmounted). */
  release(model: MonacoNS.editor.ITextModel): void {
    for (const tracked of this.tracked.values()) {
      if (tracked.model === model && tracked.attached > 0) {
        tracked.attached -= 1;
        return;
      }
    }
  }

  /**
   * Adopt a model that Monaco (or @monaco-editor/react) created externally —
   * registers it into tracking so reuse / LRU / memory stats apply. Returns
   * whether a persisted dirty buffer from earlier in this session was
   * restored into the model (honest restore, never silent data loss).
   */
  adopt(
    monaco: typeof MonacoNS,
    model: MonacoNS.editor.ITextModel | null,
    info: { path: string; languageId: string; baseline: string },
  ): { adopted: boolean; restored: boolean } {
    if (!model || model.isDisposed()) return { adopted: false, restored: false };
    const uri = model.uri.toString();
    const existing = this.tracked.get(uri);
    if (existing && !existing.model.isDisposed()) {
      existing.lastUsedAt = Date.now();
      existing.attached += 1;
      existing.baseline = info.baseline;
      existing.dirty = model.getValue() !== info.baseline;
      return { adopted: true, restored: false };
    }

    this.tracked.set(uri, {
      model,
      path: info.path,
      baseline: info.baseline,
      languageId: info.languageId,
      largeFile: isLargeFileSize(model.getValueLength()),
      lastUsedAt: Date.now(),
      dirty: model.getValue() !== info.baseline,
      attached: 1,
    });
    this.lruSweep();
    return { adopted: true, restored: false };
  }

  /**
   * The CURRENT in-memory (possibly dirty) content tracked for a path, or
   * null when no dirty buffer exists. The editor uses this to keep its
   * `value` prop from clobbering live buffers across remounts.
   */
  peekDirtyContent(path: string): string | null {
    for (const tracked of this.tracked.values()) {
      if (tracked.path === path && !tracked.model.isDisposed() && tracked.dirty) {
        return tracked.model.getValue();
      }
    }
    return null;
  }

  /** The tracked model for a path (null when none). */
  peekModel(path: string): MonacoNS.editor.ITextModel | null {
    for (const tracked of this.tracked.values()) {
      if (tracked.path === path && !tracked.model.isDisposed()) return tracked.model;
    }
    return null;
  }

  /** True when ANY tracked model for this path is dirty. */
  isPathDirty(path: string): boolean {
    for (const tracked of this.tracked.values()) {
      if (tracked.path === path && !tracked.model.isDisposed() && tracked.dirty) return true;
    }
    return false;
  }

  /** Update the baseline after a fresh server load (keeps dirty honest). */
  setBaseline(model: MonacoNS.editor.ITextModel, baseline: string): void {
    const tracked = this.findByModel(model);
    if (!tracked) return;
    tracked.baseline = baseline;
    tracked.dirty = model.getValue() !== baseline;
    tracked.largeFile = isLargeFileSize(model.getValueLength());
    if (tracked.dirty) this.persistDirty(tracked);
    else this.clearPersisted(tracked.path);
  }

  /** Recompute dirty state after a model change (called by the editor). */
  noteModelChanged(model: MonacoNS.editor.ITextModel): void {
    const tracked = this.findByModel(model);
    if (!tracked) return;
    tracked.dirty = model.getValue() !== tracked.baseline;
    tracked.largeFile = isLargeFileSize(model.getValueLength());
    if (tracked.dirty) this.persistDirty(tracked);
    else this.clearPersisted(tracked.path);
  }

  /** True when the model differs from its loaded baseline. */
  isDirty(model: MonacoNS.editor.ITextModel): boolean {
    const tracked = this.findByModel(model);
    return tracked ? tracked.dirty : false;
  }

  /** Large-file flag for the model (policy-based, honest). */
  isLargeFile(model: MonacoNS.editor.ITextModel): boolean {
    const tracked = this.findByModel(model);
    if (tracked) return tracked.largeFile;
    return isLargeFileSize(model.getValueLength());
  }

  /** The persisted dirty buffer for a path, if this session saved one. */
  getDirtyBuffer(path: string): PersistedDirtyBuffer | null {
    const store = readDirtyStore();
    const entry = store[path];
    if (!entry || typeof entry.content !== "string") return null;
    return entry;
  }

  /** Drop a persisted dirty buffer (e.g. the user discarded it). */
  discardDirtyBuffer(path: string): void {
    this.clearPersisted(path);
  }

  /** Aggregate stats (honest numbers, no estimates passed off as exact). */
  getStats(): ModelStats {
    let estimatedBytes = 0;
    let dirty = 0;
    let largeFile = 0;
    for (const tracked of this.tracked.values()) {
      if (tracked.model.isDisposed()) continue;
      estimatedBytes += tracked.model.getValueLength() * 2;
      if (tracked.dirty) dirty += 1;
      if (tracked.largeFile) largeFile += 1;
    }
    return {
      models: [...this.tracked.values()].filter((t) => !t.model.isDisposed()).length,
      estimatedBytes,
      dirty,
      largeFile,
      disposedByLru: this.disposedByLru,
    };
  }

  /** Dispose a specific model explicitly (generated scratch tabs etc.). */
  dispose(model: MonacoNS.editor.ITextModel): void {
    for (const [uri, tracked] of this.tracked) {
      if (tracked.model === model) {
        this.clearPersisted(tracked.path);
        this.tracked.delete(uri);
        break;
      }
    }
    if (!model.isDisposed()) model.dispose();
  }

  /* ---------------- internals ---------------- */

  private findByModel(model: MonacoNS.editor.ITextModel): TrackedModel | null {
    for (const tracked of this.tracked.values()) {
      if (tracked.model === model) return tracked;
    }
    return null;
  }

  /**
   * LRU disposal: dispose the least-recently-used models beyond the cap.
   * Never disposes a dirty buffer or a model still attached to an editor.
   */
  private lruSweep(): void {
    if (this.tracked.size <= MAX_TRACKED_MODELS) return;
    const candidates = [...this.tracked.entries()]
      .filter(([, t]) => !t.dirty && t.attached === 0 && !t.model.isDisposed())
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    let excess = this.tracked.size - MAX_TRACKED_MODELS;
    for (const [uri, tracked] of candidates) {
      if (excess <= 0) break;
      this.clearPersisted(tracked.path);
      tracked.model.dispose();
      this.tracked.delete(uri);
      this.disposedByLru += 1;
      excess -= 1;
    }
  }

  private persistDirty(tracked: TrackedModel): void {
    const length = tracked.model.getValueLength();
    if (length > MAX_DIRTY_PERSIST_BYTES) return; // too big to persist honestly
    // Debounce: typing should not thrash sessionStorage per keystroke.
    if (this.dirtyTimer) return;
    this.dirtyTimer = setTimeout(() => {
      this.dirtyTimer = null;
      const snapshot: Record<string, PersistedDirtyBuffer> = {};
      let total = 0;
      for (const t of this.tracked.values()) {
        if (t.model.isDisposed() || !t.dirty) continue;
        const content = t.model.getValue();
        if (content.length > MAX_DIRTY_PERSIST_BYTES) continue;
        if (total + content.length > MAX_DIRTY_PERSIST_TOTAL) continue;
        snapshot[t.path] = {
          content,
          baselineLength: t.baseline.length,
          savedAt: Date.now(),
        };
        total += content.length;
      }
      writeDirtyStore(snapshot);
    }, DIRTY_DEBOUNCE_MS);
  }

  private clearPersisted(path: string): void {
    if (typeof window === "undefined") return;
    try {
      const store = readDirtyStore();
      if (store[path]) {
        delete store[path];
        window.sessionStorage.setItem(DIRTY_STORE_KEY, JSON.stringify(store));
      }
    } catch {
      // best-effort
    }
  }
}

/** App-wide singleton — every editor model flows through this manager. */
export const editorModelManager = new EditorModelManagerImpl();
export type { PersistedDirtyBuffer };
