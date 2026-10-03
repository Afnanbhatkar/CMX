"use client";

/**
 * CodeMind X V2 — developer workspace (Phase 5).
 *
 * Three conceptual regions (spec §1), all user-resizable:
 *   LEFT   — repository tree (RepositoryExplorerShell)
 *   CENTER — tab strip + editor/output vertical split
 *   RIGHT  — file intelligence panel (Phase 5)
 *
 * Phase 2/4 behavior preserved: focus mode (`explorerOpen=false` gives the
 * editor the full width), the vertical editor/output split, and the honest
 * file loader contract:
 *   200 → ready · 403/404 → missing · 413 → too-large · 415 → binary
 *   other / network failure → error (+ message)
 *
 * Phase 5: per-path request aborts, provenance metadata captured from the
 * file API's additive `meta` field (session-only, never persisted), range
 * targets forwarded to the editor, compact stacked layout below 768px
 * container width (intelligence hidden — honest, no cramped panels).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { FileProvenanceMeta, RepoFile } from "@/features/workspace/types";
import { registerEditorBaseline, pruneEditorBaselines } from "@/features/workspace/editor/baselines";
import { useWorkspaceStore } from "@/stores/workspace-store";

import { CodeEditorViewport } from "./CodeEditorViewport";
import type { CodeFileMeta, EditorRange } from "./CodeEditorViewport";
import { EditorDockPanel } from "./EditorDockPanel";
import { EditorTabs } from "./EditorTabs";
import { FileIntelligencePanel } from "./FileIntelligencePanel";
import { RepositoryExplorerShell } from "./RepositoryExplorerShell";

export interface RepositoryWorkspaceProps {
  /** Focus the explorer filter input (Search rail view). */
  filterAutoFocus?: boolean;
  /** Show the DiagnosticsPanel instead of TerminalOutputPanel below the editor. */
  showDiagnostics?: boolean;
  /** Target line for the active tab, from the last editor navigation payload. */
  targetLine?: number;
  /** Target range for the active tab, from the last editor navigation payload. */
  targetRange?: EditorRange;
}

/**
 * Transient per-file metadata captured from the last successful file API
 * response (language / truncated / size / provenance). The store persists tab
 * paths only, so this lives here with the same lifetime as tab contents —
 * session only, never persisted.
 */
const fileMetaRegistry = new Map<string, CodeFileMeta>();

/** Compact-width probe: stacked layout below this breakpoint (sheet mounts). */
const COMPACT_QUERY = "(max-width: 767px)";

function useCompactWidth(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return compact;
}

export function RepositoryWorkspace({
  filterAutoFocus = false,
  showDiagnostics = false,
  targetLine,
  targetRange,
}: RepositoryWorkspaceProps) {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const setTabStatus = useWorkspaceStore((s) => s.setTabStatus);
  const explorerOpen = useWorkspaceStore((s) => s.explorerOpen);
  const intelligenceOpen = useWorkspaceStore((s) => s.intelligenceOpen);
  const splitEditor = useWorkspaceStore((s) => s.splitEditor);
  const paneBPath = useWorkspaceStore((s) => s.paneBPath);

  const compact = useCompactWidth();

  /* path → AbortController for the request currently in flight. */
  const inflightRef = useRef(new Map<string, AbortController>());

  useEffect(() => {
    // Prune metadata + editor baselines for tabs that no longer exist.
    const livePaths = tabs.map((t) => t.path);
    if (fileMetaRegistry.size > 0) {
      const live = new Set(livePaths);
      for (const key of fileMetaRegistry.keys()) {
        if (!live.has(key)) fileMetaRegistry.delete(key);
      }
    }
    pruneEditorBaselines(livePaths);

    const loading = tabs.filter((t) => t.status === "loading");
    if (loading.length === 0) return;

    // Concurrency cap: exactly one in-flight request; the active tab first.
    const next = loading.find((t) => t.path === activeTabPath) ?? loading[0];
    const path = next.path;
    if (inflightRef.current.has(path)) return;

    const controller = new AbortController();
    inflightRef.current.set(path, controller);

    void (async () => {
      try {
        const res = await fetch(`/api/repository/file?path=${encodeURIComponent(path)}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { ok?: boolean; file?: RepoFile; meta?: FileProvenanceMeta }
            | null;
          const file = data?.ok === true ? data.file : undefined;
          const provenanceMeta = data?.ok === true ? data.meta : undefined;
          if (file && typeof file.content === "string") {
            fileMetaRegistry.set(path, {
              language: file.language,
              truncated: file.truncated,
              size: file.size,
              // Additive provenance (V2.1 §B/§D) — present when the backend
              // resolved it, absent (never fabricated) otherwise.
              provenance: provenanceMeta ?? undefined,
            });
            // Register the loaded content as the dirty-tracking baseline.
            registerEditorBaseline(path, file.content);
            setTabStatus(path, "ready", { content: file.content });
          } else {
            setTabStatus(path, "error", {
              error: "The file service returned an unexpected response.",
            });
          }
          return;
        }

        if (res.status === 403 || res.status === 404) setTabStatus(path, "missing");
        else if (res.status === 413) setTabStatus(path, "too-large");
        else if (res.status === 415) setTabStatus(path, "binary");
        else {
          setTabStatus(path, "error", {
            error: `The file service responded with HTTP ${res.status}.`,
          });
        }
      } catch (err) {
        // Aborted (unmounted / superseded): never write state afterwards.
        if (inflightRef.current.get(path) !== controller) return;
        setTabStatus(path, "error", {
          error:
            err instanceof Error && err.name !== "AbortError"
              ? err.message
              : "The file service is unreachable right now.",
        });
      } finally {
        if (inflightRef.current.get(path) === controller) {
          inflightRef.current.delete(path);
        }
      }
    })();
  }, [tabs, activeTabPath, setTabStatus]);

  /* Unmount: abort every in-flight fetch. */
  useEffect(() => {
    const inflight = inflightRef.current;
    return () => {
      for (const controller of inflight.values()) controller.abort();
      inflight.clear();
    };
  }, []);

  const activeMeta = activeTabPath ? fileMetaRegistry.get(activeTabPath) : undefined;

  /* Compact layout: tabs + editor stacked, no horizontal resizing panels. */
  if (compact) {
    return (
      <div className="flex min-h-0 flex-1">
        {explorerOpen ? (
          <div className="flex w-full min-w-0 flex-col border-r border-border-subtle">
            <RepositoryExplorerShell filterAutoFocus={filterAutoFocus} />
          </div>
        ) : null}
        {!explorerOpen ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <EditorTabs />
            <ResizablePanelGroup
              id="cmx-repo-vertical-v1"
              direction="vertical"
              className="min-h-0 flex-1"
            >
              <ResizablePanel defaultSize={72} minSize={25}>
                <CodeEditorViewport
                  line={targetLine}
                  range={targetRange}
                  meta={activeMeta}
                />
              </ResizablePanel>
              <ResizableHandle
                aria-label="Resize editor / output"
                className="transition-colors after:bg-primary/20 hover:after:bg-primary/50"
              />
              <ResizablePanel defaultSize={28} minSize={15}>
                <EditorDockPanel requestedTab={showDiagnostics ? "problems" : null} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <ResizablePanelGroup id="cmx-repo-h-v1" direction="horizontal" className="min-h-0 flex-1">
      {/* LEFT — repository tree (hidden entirely in focus mode). */}
      {explorerOpen ? (
        <>
          <ResizablePanel defaultSize={28} minSize={14} maxSize={40}>
            <div className="flex h-full min-h-0 flex-col border-r border-border-subtle">
              <RepositoryExplorerShell filterAutoFocus={filterAutoFocus} />
            </div>
          </ResizablePanel>
          <ResizableHandle
            aria-label="Resize explorer panel"
            className="transition-colors after:bg-primary/20 hover:after:bg-primary/50"
          />
        </>
      ) : null}

      {/* CENTER — tabs + editor/output vertical split (preserved ids/sizes). */}
      <ResizablePanel minSize={35}>
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <EditorTabs />
          <ResizablePanelGroup
            id="cmx-repo-vertical-v1"
            direction="vertical"
            className="min-h-0 flex-1"
          >
            <ResizablePanel defaultSize={72} minSize={25}>
              {splitEditor ? (
                <ResizablePanelGroup
                  id="cmx-editor-split-v1"
                  direction="horizontal"
                  className="min-h-0"
                >
                  <ResizablePanel defaultSize={50} minSize={20}>
                    <CodeEditorViewport
                      line={targetLine}
                      range={targetRange}
                      meta={activeMeta}
                      paneId="a"
                    />
                  </ResizablePanel>
                  <ResizableHandle
                    aria-label="Resize split editors"
                    className="transition-colors after:bg-primary/20 hover:after:bg-primary/50"
                  />
                  <ResizablePanel defaultSize={50} minSize={20}>
                    <CodeEditorViewport
                      meta={paneBPath ? fileMetaRegistry.get(paneBPath) : undefined}
                      paneId="b"
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              ) : (
                <CodeEditorViewport
                  line={targetLine}
                  range={targetRange}
                  meta={activeMeta}
                  paneId="a"
                />
              )}
            </ResizablePanel>
            <ResizableHandle
              aria-label="Resize editor / output"
              className="transition-colors after:bg-primary/20 hover:after:bg-primary/50"
            />
            <ResizablePanel defaultSize={28} minSize={15}>
              <EditorDockPanel requestedTab={showDiagnostics ? "problems" : null} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </ResizablePanel>

      {/* RIGHT — file intelligence (Phase 5). Hidden when toggled off. */}
      {intelligenceOpen ? (
        <>
          <ResizableHandle
            aria-label="Resize file intelligence panel"
            className="transition-colors after:bg-primary/20 hover:after:bg-primary/50"
          />
          <ResizablePanel defaultSize={24} minSize={16} maxSize={34}>
            <div className="flex h-full min-h-0 flex-col border-l border-border-subtle">
              <FileIntelligencePanel filePath={activeTabPath} />
            </div>
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}
