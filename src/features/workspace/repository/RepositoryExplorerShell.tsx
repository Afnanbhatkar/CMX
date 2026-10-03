"use client";

/**
 * CodeMind X V2 — repository explorer sidebar (Phase 2).
 *
 * Real tree from GET /api/repository/tree (via useRepositoryTree):
 * - header with view label + reload + CLOSE (focus mode, Phase 4 session:
 *   closing the explorer gives the code editor the full panel width; the
 *   editor tab strip and the activity rail reopen it)
 * - filter input: case-insensitive substring match over the flattened file
 *   list; while filtering, a flat result list replaces the tree
 * - recursive, memoized file tree; depth-0 directories start open, deeper
 *   directories start collapsed (user overrides win)
 * - file clicks go through editorNavigation.open — the single opening mechanism
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FileCode2, Folder, FolderOpen, PanelLeftClose, RefreshCw } from "lucide-react";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import type { RepoTreeNode } from "@/features/workspace/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

import { useRepositoryTree } from "./use-repository-tree";

export interface RepositoryExplorerShellProps {
  /** Focus the filter input (used by the Search rail view). */
  filterAutoFocus?: boolean;
}

/* ------------------------------------------------------------------ */
/* Tree row (memoized)                                                 */
/* ------------------------------------------------------------------ */

interface TreeNodeRowProps {
  node: RepoTreeNode;
  depth: number;
  activePath: string | null;
  openOverrides: Map<string, boolean>;
  onToggleDir: (path: string, next: boolean) => void;
  onOpenFile: (path: string) => void;
}

const TreeNodeRow = memo(function TreeNodeRow({
  node,
  depth,
  activePath,
  openOverrides,
  onToggleDir,
  onOpenFile,
}: TreeNodeRowProps) {
  // Default: depth-0 directories open, deeper ones collapsed. User toggles win.
  const isOpen = openOverrides.get(node.path) ?? depth === 0;

  if (node.type === "file") {
    const active = node.path === activePath;
    return (
      <button
        type="button"
        onClick={() => onOpenFile(node.path)}
        aria-current={active ? "true" : undefined}
        title={node.path}
        className={cn(
          "relative flex h-7 w-full items-center gap-1 rounded px-1 text-left text-[12px]",
          "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          active && "bg-surface-hover",
        )}
      >
        {active ? (
          <span aria-hidden="true" className="absolute left-0 h-4 w-0.5 rounded bg-primary" />
        ) : null}
        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggleDir(node.path, !isOpen)}
        aria-expanded={isOpen}
        className={cn(
          "flex h-7 w-full items-center gap-1 rounded px-1 text-left text-[12px]",
          "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-90",
          )}
        />
        {isOpen ? (
          <FolderOpen className="size-3.5 shrink-0 text-primary/80" aria-hidden="true" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-primary/80" aria-hidden="true" />
        )}
        <span className="min-w-0 truncate">{node.name}</span>
      </button>

      {isOpen && node.children && node.children.length > 0 ? (
        <div className="ml-2.5 border-l border-border-subtle pl-3">
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              openOverrides={openOverrides}
              onToggleDir={onToggleDir}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Filter result row (memoized)                                        */
/* ------------------------------------------------------------------ */

const FilterResultRow = memo(function FilterResultRow({
  path,
  active,
}: {
  path: string;
  active: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => void editorNavigation.open({ filePath: path, sourceContext: "manual" })}
      aria-current={active ? "true" : undefined}
      title={path}
      className={cn(
        "relative flex h-7 w-full items-center gap-1.5 rounded px-1 text-left",
        "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active && "bg-surface-hover",
      )}
    >
      {active ? (
        <span aria-hidden="true" className="absolute left-0 h-4 w-0.5 rounded bg-primary" />
      ) : null}
      <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate font-mono text-[11px] text-foreground/85">{path}</span>
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

const SKELETON_WIDTHS = ["w-full", "w-[80%]", "w-full", "w-[65%]", "w-[90%]", "w-full", "w-[75%]", "w-[85%]"];

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 p-3 text-center">
      {children}
    </div>
  );
}

export function RepositoryExplorerShell({ filterAutoFocus = false }: RepositoryExplorerShellProps) {
  const { tree, loading, error, reload, flattened } = useRepositoryTree();
  const repoRailView = useWorkspaceStore((s) => s.repoRailView);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const setExplorerOpen = useWorkspaceStore((s) => s.setExplorerOpen);

  const [filter, setFilter] = useState("");
  // Sparse open/closed overrides; absent = default (depth 0 open).
  const [openOverrides, setOpenOverrides] = useState<Map<string, boolean>>(() => new Map());

  const filterRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (filterAutoFocus) filterRef.current?.focus();
  }, [filterAutoFocus]);

  const toggleDir = useCallback((path: string, next: boolean) => {
    setOpenOverrides((prev) => {
      const map = new Map(prev);
      map.set(path, next);
      return map;
    });
  }, []);

  const openFile = useCallback((path: string) => {
    void editorNavigation.open({ filePath: path, sourceContext: "manual" });
  }, []);

  const query = filter.trim().toLowerCase();
  const filtering = query.length > 0;

  const matches = useMemo(() => {
    if (!filtering) return [];
    return flattened.filter((node) => node.path.toLowerCase().includes(query));
  }, [filtering, flattened, query]);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      {/* Header */}
      <header className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border-subtle px-2">
        <span className="min-w-0 truncate text-[11px] uppercase tracking-wider text-muted-foreground">
          {repoRailView === "search" ? "Search" : "Explorer"}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Reload tree"
                onClick={reload}
                disabled={loading}
                className={cn(
                  "flex size-6 items-center justify-center rounded-md text-muted-foreground",
                  "hover:bg-surface-hover hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn("size-3.5", loading && "animate-spin")}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Reload tree</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Close explorer — focus the editor"
                onClick={() => setExplorerOpen(false)}
                className={cn(
                  "flex size-6 items-center justify-center rounded-md text-muted-foreground",
                  "hover:bg-surface-hover hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                <PanelLeftClose aria-hidden="true" className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Close explorer — focus the editor</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Filter */}
      <div className="shrink-0 px-2 py-1.5">
        <Input
          ref={filterRef}
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter files…"
          aria-label="Filter files"
          className="h-7 border-border-subtle bg-surface-elevated/40 px-2 text-xs"
        />
      </div>

      {/* Body */}
      <div aria-busy={loading} className="min-h-0 flex-1 overflow-y-auto p-1">
        {loading ? (
          <div aria-hidden="true" className="flex flex-col gap-1 p-0.5">
            {SKELETON_WIDTHS.map((width, index) => (
              <Skeleton key={index} className={cn("h-7 rounded", width)} />
            ))}
          </div>
        ) : error ? (
          <CenteredNote>
            <p className="text-[12px] text-muted-foreground">Repository tree unavailable.</p>
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={reload}>
              Retry
            </Button>
          </CenteredNote>
        ) : filtering ? (
          matches.length === 0 ? (
            <CenteredNote>
              <p className="text-[12px] text-muted-foreground">No files match.</p>
            </CenteredNote>
          ) : (
            <div className="max-h-full space-y-0.5 overflow-y-auto" aria-label="Matching files">
              {matches.map((node) => (
                <FilterResultRow key={node.path} path={node.path} active={node.path === activeTabPath} />
              ))}
            </div>
          )
        ) : tree.length === 0 ? (
          <CenteredNote>
            <p className="text-[12px] text-muted-foreground">No files</p>
          </CenteredNote>
        ) : (
          <div className="space-y-0.5">
            {tree.map((node) => (
              <TreeNodeRow
                key={node.path}
                node={node}
                depth={0}
                activePath={activeTabPath}
                openOverrides={openOverrides}
                onToggleDir={toggleDir}
                onOpenFile={openFile}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
