"use client";

/**
 * CodeMind X V2 — repository workspace shell (Phase 2).
 *
 * Composition root of the repository/code side of the four-panel workspace:
 * - left: icon activity rail (view switch + diagnostics toggle)
 * - right: the view selected by `repoRailView`
 *   - explorer/search → the editor workspace (explorer sidebar + tabs + editor/output split)
 *   - git/run/extensions → honest, non-simulated views
 *
 * Editor navigation (spec §28): the shell subscribes to the EditorNavigation
 * service — THE single mechanism for opening files (chat references, search
 * results, palette, tree clicks). The service validates + fetches the file
 * first; on success this shell opens the tab via the store and remembers the
 * requested target line per file path.
 */

import { useCallback, useEffect, useState } from "react";
import { Blocks, Play } from "lucide-react";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import { useWorkspaceStore } from "@/stores/workspace-store";

import { GitPanel } from "./GitPanel";
import { PlaceholderView } from "./PlaceholderView";
import { RepoActivityRail } from "./RepoActivityRail";
import { RepositoryWorkspace } from "./RepositoryWorkspace";

export function RepositoryWorkspaceShell() {
  const repoRailView = useWorkspaceStore((s) => s.repoRailView);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);

  const [showDiagnostics, setShowDiagnostics] = useState(false);

  /**
   * Latest navigation target line per file path, from editorNavigation
   * payloads (keyed by path; the active tab reads its own entry).
   */
  const [lineTargets, setLineTargets] = useState<Record<string, number>>({});

  useEffect(
    () =>
      editorNavigation.subscribe((payload) => {
        // The service has already validated + verified the file — open the tab.
        useWorkspaceStore.getState().openTab(payload.filePath);
        const targetLine =
          typeof payload.line === "number" && payload.line > 0
            ? Math.floor(payload.line)
            : undefined;
        if (targetLine !== undefined) {
          setLineTargets((prev) => ({ ...prev, [payload.filePath]: targetLine }));
        }
      }),
    [],
  );

  const toggleDiagnostics = useCallback(() => setShowDiagnostics((v) => !v), []);

  const targetLine = activeTabPath ? lineTargets[activeTabPath] : undefined;

  return (
    <div className="flex h-full min-h-0 bg-surface">
      <RepoActivityRail showDiagnostics={showDiagnostics} onToggleDiagnostics={toggleDiagnostics} />

      <div className="flex min-w-0 flex-1 flex-col">
        {repoRailView === "explorer" || repoRailView === "search" ? (
          <RepositoryWorkspace
            filterAutoFocus={repoRailView === "search"}
            showDiagnostics={showDiagnostics}
            targetLine={targetLine}
          />
        ) : null}

        {repoRailView === "git" ? <GitPanel /> : null}

        {repoRailView === "run" ? (
          <PlaceholderView
            title="Run and Debug"
            icon={Play}
            note="No execution engine is connected — sandbox execution arrives in a later phase."
            detail="This view is a wired extension point. Nothing is simulated."
          />
        ) : null}

        {repoRailView === "extensions" ? (
          <PlaceholderView
            title="Extensions"
            icon={Blocks}
            note="No extension registry is connected yet."
            detail="This view is a wired extension point. Nothing is simulated."
          />
        ) : null}
      </div>
    </div>
  );
}
