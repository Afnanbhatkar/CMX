"use client";

/**
 * CodeMind X V2 — editor tab strip (Phase 5).
 *
 * Phase 2 core preserved: tabs mirror the workspace store (order preserved),
 * activate on click / Enter / Space, close button stops propagation, focus-
 * mode explorer reopen button at the left edge.
 *
 * Phase 5 (spec §5):
 * - git working-tree dot per tab (real status from the shared map; unsaved-
 *   edit tracking itself arrives with the rich editor [PLANNED])
 * - middle-click close, per-tab context menu (close / close others / close
 *   all / reopen closed), reopen-closed button
 * - overflow menu beyond 8 tabs, keyboard cycling (Alt+ArrowLeft/Right) and
 *   Alt+W close, intelligence panel toggle
 *
 * Note: tabs are div[role="tab"] (not <button>) because they contain real
 * nested <button>s — nested interactive elements are invalid HTML.
 */

import { memo, useEffect } from "react";
import {
  Columns2,
  History,
  FileCode2,
  PanelLeftOpen,
  PanelRight,
  X,
} from "lucide-react";

import type { TreeGitStatus } from "@/features/workspace/types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/stores/workspace-store";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

const MAX_VISIBLE_TABS = 8;

const GIT_DOT: Record<TreeGitStatus, { className: string; label: string }> = {
  modified: { className: "bg-amber-500", label: "Modified in working tree" },
  added: { className: "bg-emerald-500", label: "Added to working tree" },
  deleted: { className: "bg-red-500", label: "Deleted in working tree" },
  untracked: { className: "bg-stone-400", label: "Untracked" },
  renamed: { className: "bg-violet-500", label: "Renamed in working tree" },
};

interface EditorTabProps {
  path: string;
  active: boolean;
  gitStatus: TreeGitStatus | null;
  /** In-memory buffer differs from the loaded file (Phase 6). */
  dirty?: boolean;
  generated?: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

const EditorTab = memo(function EditorTab({
  path,
  active,
  gitStatus,
  dirty,
  generated,
  onSelect,
  onClose,
}: EditorTabProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={active}
          tabIndex={0}
          title={path}
          onClick={() => onSelect(path)}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              onClose(path);
            }
          }}
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
            {generated ? "\u2699 " : ""}{basename(path)}
          </span>
          {dirty ? (
            <span
              aria-label="Unsaved in-memory changes"
              title="Unsaved (in-memory)"
              className="size-1.5 shrink-0 rounded-full bg-amber-500"
            />
          ) : gitStatus ? (
            <span
              aria-label={GIT_DOT[gitStatus].label}
              title={GIT_DOT[gitStatus].label}
              className={cn("size-1.5 shrink-0 rounded-full", GIT_DOT[gitStatus].className)}
            />
          ) : null}
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
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => onSelect(path)}>Open</ContextMenuItem>
        <ContextMenuItem onSelect={() => onClose(path)}>Close</ContextMenuItem>
        <ContextMenuSeparator />
        <TabActions path={path} />
      </ContextMenuContent>
    </ContextMenu>
  );
});

/** Shared context-menu actions (works inside the per-tab menu and the overflow menu). */
function TabActions({ path }: { path: string }) {
  const closeOtherTabs = useWorkspaceStore((s) => s.closeOtherTabs);
  const closeAllTabs = useWorkspaceStore((s) => s.closeAllTabs);
  const reopenClosedTab = useWorkspaceStore((s) => s.reopenClosedTab);
  const closedCount = useWorkspaceStore((s) => s.closedTabs.length);

  return (
    <>
      <ContextMenuItem onSelect={() => closeOtherTabs(path)}>Close others</ContextMenuItem>
      <ContextMenuItem onSelect={() => closeAllTabs()}>Close all</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={closedCount === 0}
        title={closedCount === 0 ? "No closed tabs" : "Reopens the most recently closed tab"}
        onSelect={() => reopenClosedTab()}
      >
        Reopen closed tab
      </ContextMenuItem>
    </>
  );
}

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

/** Right-side strip actions: reopen closed + split editor + intelligence toggle. */
function StripActions() {
  const reopenClosedTab = useWorkspaceStore((s) => s.reopenClosedTab);
  const closedCount = useWorkspaceStore((s) => s.closedTabs.length);
  const intelligenceOpen = useWorkspaceStore((s) => s.intelligenceOpen);
  const setIntelligenceOpen = useWorkspaceStore((s) => s.setIntelligenceOpen);
  const splitEditor = useWorkspaceStore((s) => s.splitEditor);
  const toggleSplitEditor = useWorkspaceStore((s) => s.toggleSplitEditor);

  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5 border-l border-border-subtle px-1">
      {closedCount > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Reopen closed tab"
              onClick={() => reopenClosedTab()}
              className={cn(
                "flex size-7 items-center justify-center rounded-md text-muted-foreground",
                "hover:bg-surface-hover hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              <History aria-hidden="true" className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Reopen closed tab</TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Toggle split editor"
            aria-pressed={splitEditor}
            onClick={toggleSplitEditor}
            className={cn(
              "flex size-7 items-center justify-center rounded-md text-muted-foreground",
              "hover:bg-surface-hover hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              splitEditor && "text-foreground",
            )}
          >
            <Columns2 aria-hidden="true" className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {splitEditor ? "Close split editor" : "Split editor"}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Toggle file intelligence panel"
            aria-pressed={intelligenceOpen}
            onClick={() => setIntelligenceOpen(!intelligenceOpen)}
            className={cn(
              "flex size-7 items-center justify-center rounded-md text-muted-foreground",
              "hover:bg-surface-hover hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              intelligenceOpen && "text-foreground",
            )}
          >
            <PanelRight aria-hidden="true" className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Toggle file intelligence panel</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function EditorTabs() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const reopenClosedTab = useWorkspaceStore((s) => s.reopenClosedTab);
  const explorerOpen = useWorkspaceStore((s) => s.explorerOpen);

  /* Keyboard: Alt+ArrowLeft/Right cycle tabs, Alt+W closes the active tab.
     (Ctrl+W is reserved by the browser and cannot be reliably intercepted.) */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const openTabs = useWorkspaceStore.getState().tabs;
      if (openTabs.length === 0) return;
      const active = useWorkspaceStore.getState().activeTabPath;
      const index = openTabs.findIndex((t) => t.path === active);

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const nextIndex =
          openTabs.length === 0
            ? 0
            : (index + (event.key === "ArrowRight" ? 1 : openTabs.length - 1)) % openTabs.length;
        const next = openTabs[nextIndex];
        if (next) setActiveTab(next.path);
        return;
      }
      if (event.key === "w" || event.key === "W") {
        event.preventDefault();
        if (active) closeTab(active);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setActiveTab, closeTab]);

  const visibleTabs = tabs.slice(0, MAX_VISIBLE_TABS);
  const overflowTabs = tabs.slice(MAX_VISIBLE_TABS);

  if (tabs.length === 0) {
    return (
      <div className="flex h-9 shrink-0 items-center border-b border-border-subtle bg-surface">
        {!explorerOpen ? <ExplorerReopenButton /> : null}
        <span className="px-3 text-[11px] text-muted-foreground">No files open</span>
        <StripActions />
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Open files — Alt+ArrowLeft/Right to cycle, Alt+W to close"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border-subtle bg-surface [scrollbar-width:thin]"
    >
      {!explorerOpen ? (
        <div className="flex shrink-0 items-center border-r border-border-subtle pl-1 pr-0.5">
          <ExplorerReopenButton />
        </div>
      ) : null}
      {visibleTabs.map((tab) => (
        <EditorTab
          key={tab.path}
          path={tab.path}
          active={tab.path === activeTabPath}
          gitStatus={tab.gitStatus ?? null}
          dirty={tab.dirty}
          generated={tab.generated}
          onSelect={setActiveTab}
          onClose={closeTab}
        />
      ))}
      {overflowTabs.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${overflowTabs.length} more open files`}
              className={cn(
                "flex shrink-0 items-center gap-1 border-r border-border-subtle px-2.5 text-[11px] text-muted-foreground",
                "hover:bg-surface-hover hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
              )}
            >
              {overflowTabs.length} more
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
            {overflowTabs.map((tab) => (
              <DropdownMenuItem
                key={tab.path}
                onSelect={() => setActiveTab(tab.path)}
                title={tab.path}
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <FileCode2 aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {basename(tab.path)}
                  </span>
                  {tab.gitStatus ? (
                    <span
                      aria-hidden="true"
                      className={cn("size-1.5 shrink-0 rounded-full", GIT_DOT[tab.gitStatus].className)}
                    />
                  ) : null}
                  {tab.path === activeTabPath ? (
                    <span aria-hidden="true" className="text-[10px] text-primary">●</span>
                  ) : null}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <TabActions path={activeTabPath ?? ""} />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <StripActions />
    </div>
  );
}
