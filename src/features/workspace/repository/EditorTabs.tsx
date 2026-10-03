"use client";

/**
 * CodeMind X V2 — editor tab strip (Phase 2).
 *
 * Tabs mirror the workspace store (order preserved). Each tab shows the file
 * basename (full path as title), activates on click / Enter / Space, and has
 * a close button (stopPropagation so closing never activates the tab).
 *
 * FOCUS MODE (Phase 4 session): while the explorer column is closed, a
 * reopen control sits at the left edge of the strip (both in the empty and
 * populated states) so full-width code focus is always one click away from
 * restoring the file tree.
 *
 * Note: tabs are div[role="tab"] (not <button>) because they contain a real
 * nested <button> for close — nested interactive elements are invalid HTML.
 */

import { memo } from "react";
import { FileCode2, PanelLeftOpen, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/stores/workspace-store";

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

interface EditorTabProps {
  path: string;
  active: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

const EditorTab = memo(function EditorTab({ path, active, onSelect, onClose }: EditorTabProps) {
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={path}
      onClick={() => onSelect(path)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(path);
        }
      }}
      className={cn(
        "group relative flex min-w-[120px] max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border-subtle pl-2.5 pr-1",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        active ? "bg-surface-elevated" : "hover:bg-surface-hover",
      )}
    >
      {active ? (
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
      ) : null}
      <FileCode2 className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-foreground/90">
        {basename(path)}
      </span>
      <button
        type="button"
        aria-label={`Close ${path}`}
        onClick={(event) => {
          event.stopPropagation();
          onClose(path);
        }}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
});

/**
 * Reopen affordance rendered only while the explorer column is closed.
 */
function ExplorerReopenButton() {
  const setExplorerOpen = useWorkspaceStore((s) => s.setExplorerOpen);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Open explorer"
          onClick={() => setExplorerOpen(true)}
          className={cn(
            "mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground",
            "hover:bg-surface-hover hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        >
          <PanelLeftOpen aria-hidden="true" className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Open explorer</TooltipContent>
    </Tooltip>
  );
}

export function EditorTabs() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const explorerOpen = useWorkspaceStore((s) => s.explorerOpen);

  if (tabs.length === 0) {
    return (
      <div className="flex h-9 shrink-0 items-center border-b border-border-subtle bg-surface">
        {!explorerOpen ? <ExplorerReopenButton /> : null}
        <span className="px-3 text-[11px] text-muted-foreground">No files open</span>
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Open files"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border-subtle bg-surface [scrollbar-width:thin]"
    >
      {!explorerOpen ? (
        <div className="flex shrink-0 items-center border-r border-border-subtle pl-1 pr-0.5">
          <ExplorerReopenButton />
        </div>
      ) : null}
      {tabs.map((tab) => (
        <EditorTab
          key={tab.path}
          path={tab.path}
          active={tab.path === activeTabPath}
          onSelect={setActiveTab}
          onClose={closeTab}
        />
      ))}
    </div>
  );
}
