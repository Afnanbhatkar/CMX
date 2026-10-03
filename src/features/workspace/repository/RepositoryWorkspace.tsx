"use client";

/**
 * CodeMind X V2 — developer workspace (Phase 2).
 *
 * Shown for the "explorer" and "search" rail views: explorer sidebar on the
 * left, editor tabs + a vertical resizable editor/output split on the right.
 *
 * FOCUS MODE (Phase 4 session directive): the explorer column can be closed
 * from its own header icon; when `explorerOpen` is false the editor takes
 * the FULL repository-panel width. Reopening is available from the editor
 * tab strip and the repository activity rail (explorer/search icons).
 *
 * FILE LOADER: for every tab with status "loading" it fetches
 * GET /api/repository/file?path=… (one in-flight request at a time; the
 * ACTIVE tab is served first, the rest queue via store re-renders) and maps
 * the real HTTP contract onto honest tab states:
 *   200 → ready · 403/404 → missing · 413 → too-large · 415 → binary
 *   other / network failure → error (+ message)
 * Aborts are cleaned up on unmount; no state is written after unmount.
 */

import { useEffect, useRef } from "react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { RepoFile } from "@/features/workspace/types";
import { useWorkspaceStore } from "@/stores/workspace-store";

import { CodeEditorViewport } from "./CodeEditorViewport";
import type { CodeFileMeta } from "./CodeEditorViewport";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { EditorTabs } from "./EditorTabs";
import { RepositoryExplorerShell } from "./RepositoryExplorerShell";
import { TerminalOutputPanel } from "./TerminalOutputPanel";

export interface RepositoryWorkspaceProps {
  /** Focus the explorer filter input (Search rail view). */
  filterAutoFocus?: boolean;
  /** Show the DiagnosticsPanel instead of TerminalOutputPanel below the editor. */
  showDiagnostics?: boolean;
  /** Target line for the active tab, from the last editor navigation payload. */
  targetLine?: number;
}

/**
 * Transient per-file metadata captured from the last successful file API
 * response (language / truncated / size). The store persists tab paths only,
 * so this lives here with the same lifetime as tab contents — session only,
 * never persisted.
 */
const fileMetaRegistry = new Map<string, CodeFileMeta>();

export function RepositoryWorkspace({
  filterAutoFocus = false,
  showDiagnostics = false,
  targetLine,
}: RepositoryWorkspaceProps) {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const setTabStatus = useWorkspaceStore((s) => s.setTabStatus);
  const explorerOpen = useWorkspaceStore((s) => s.explorerOpen);

  /* path → AbortController for the request currently in flight. */
  const inflightRef = useRef(new Map<string, AbortController>());

  useEffect(() => {
    // Prune metadata for tabs that no longer exist (paths only, cheap).
    if (fileMetaRegistry.size > 0) {
      const live = new Set(tabs.map((t) => t.path));
      for (const key of fileMetaRegistry.keys()) {
        if (!live.has(key)) fileMetaRegistry.delete(key);
      }
    }

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
            | { ok?: boolean; file?: RepoFile }
            | null;
          const file = data?.ok === true ? data.file : undefined;
          if (file && typeof file.content === "string") {
            fileMetaRegistry.set(path, {
              language: file.language,
              truncated: file.truncated,
              size: file.size,
            });
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

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left column — fixed width in v1: NOT user-resizable yet (planned).
          Hidden entirely in focus mode (explorerOpen = false). */}
      {explorerOpen ? (
        <div className="flex w-[42%] min-w-[180px] max-w-[320px] flex-col border-r border-border-subtle">
          <RepositoryExplorerShell filterAutoFocus={filterAutoFocus} />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <EditorTabs />

        <ResizablePanelGroup
          id="cmx-repo-vertical-v1"
          direction="vertical"
          className="min-h-0 flex-1"
        >
          <ResizablePanel defaultSize={72} minSize={25}>
            <CodeEditorViewport
              line={targetLine}
              meta={activeTabPath ? fileMetaRegistry.get(activeTabPath) : undefined}
            />
          </ResizablePanel>

          <ResizableHandle
            aria-label="Resize editor / output"
            className="transition-colors after:bg-primary/20 hover:after:bg-primary/50"
          />

          <ResizablePanel defaultSize={28} minSize={15}>
            {showDiagnostics ? <DiagnosticsPanel /> : <TerminalOutputPanel />}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
