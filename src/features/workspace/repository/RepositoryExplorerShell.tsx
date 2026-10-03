"use client";

/**
 * CodeMind X V2 — repository explorer sidebar (Phase 5).
 *
 * Phase 2 core preserved: real tree from GET /api/repository/tree, filter
 * input, focus-mode close, editorNavigation.open as the single file-opening
 * mechanism, honest skeleton/error/empty states.
 *
 * Phase 5 (spec §2/§8/§10):
 * - VIRTUALIZED rows via @tanstack/react-virtual — large trees never render
 *   thousands of DOM nodes simultaneously.
 * - Fuzzy filter (subsequence + scoring + highlight) replaces substring match.
 * - Per-extension file icons and git working-tree status letters
 *   (M/A/D/R/U) from the shared /api/repository/status map.
 * - Lazy directory loading for server-`truncated` directories.
 * - Right-click context menu (FileContextMenu) on every row.
 * - Breadcrumb/tree reveal support: store `treeReveal` expands ancestors,
 *   scrolls the row into view and flash-highlights it.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, PanelLeftClose, RefreshCw } from "lucide-react";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import type { RepoTreeNode, TreeGitStatus } from "@/features/workspace/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

import { DirIcon, FileIcon } from "./file-icons";
import { FileContextMenu } from "./FileContextMenu";
import { fuzzyFilter, type FuzzyResult } from "./fuzzy";
import { useRepositoryTree } from "./use-repository-tree";

export interface RepositoryExplorerShellProps {
  /** Focus the filter input (used by the Search rail view). */
  filterAutoFocus?: boolean;
}

/* ------------------------------------------------------------------ */
/* Git status letter badge                                             */
/* ------------------------------------------------------------------ */

const GIT_STATUS_META: Record<TreeGitStatus, { letter: string; className: string; label: string }> = {
  modified: { letter: "M", className: "text-amber-500", label: "Modified" },
  added: { letter: "A", className: "text-emerald-500", label: "Added" },
  deleted: { letter: "D", className: "text-red-500", label: "Deleted" },
  untracked: { letter: "U", className: "text-stone-400", label: "Untracked" },
  renamed: { letter: "R", className: "text-violet-500", label: "Renamed" },
};

const GitStatusLetter = memo(function GitStatusLetter({ status }: { status: TreeGitStatus }) {
  const meta = GIT_STATUS_META[status];
  return (
    <span
      aria-label={meta.label}
      title={`${meta.label} (working tree)`}
      className={cn(
        "w-3 shrink-0 text-right font-mono text-[10px] font-semibold leading-none",
        meta.className,
      )}
    >
      {meta.letter}
    </span>
  );
});

/* ------------------------------------------------------------------ */
/* Fuzzy highlight text                                                */
/* ------------------------------------------------------------------ */

const HighlightedText = memo(function HighlightedText({
  text,
  positions,
}: {
  text: string;
  positions: number[];
}) {
  if (positions.length === 0) return <>{text}</>;
  const set = new Set(positions);
  const parts: React.ReactNode[] = [];
  let current: string[] = [];
  let currentMatched = set.has(0);

  const flush = (key: string) => {
    if (current.length === 0) return;
    const chunk = current.join("");
    parts.push(
      currentMatched ? (
        <mark key={key} className="rounded-sm bg-primary/20 text-inherit">
          {chunk}
        </mark>
      ) : (
        <span key={key}>{chunk}</span>
      ),
    );
    current = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const matched = set.has(i);
    if (matched !== currentMatched) {
      flush(`c${i}`);
      currentMatched = matched;
    }
    current.push(text[i]);
  }
  flush("end");

  return <>{parts}</>;
});

/* ------------------------------------------------------------------ */
/* Visible row model (virtualized)                                     */
/* ------------------------------------------------------------------ */

interface VisibleRow {
  kind: "node";
  node: RepoTreeNode;
  depth: number;
}

interface LoadingRow {
  kind: "loading";
  path: string;
  depth: number;
}

type Row = VisibleRow | LoadingRow;

const ROW_HEIGHT = 28;

function buildVisibleRows(
  nodes: RepoTreeNode[],
  openOverrides: Map<string, boolean>,
  loadingDirs: ReadonlySet<string>,
  out: Row[],
): void {
  for (const node of nodes) {
    out.push({ kind: "node", node, depth: 0 });
    if (node.type === "dir") {
      const isOpen = openOverrides.get(node.path) ?? false;
      if (isOpen) {
        if (node.truncated && loadingDirs.has(node.path)) {
          out.push({ kind: "loading", path: node.path, depth: 1 });
        }
        if (node.children && node.children.length > 0) {
          pushDescendants(node.children, openOverrides, loadingDirs, out, 1);
        }
      }
    }
  }
}

function pushDescendants(
  nodes: RepoTreeNode[],
  openOverrides: Map<string, boolean>,
  loadingDirs: ReadonlySet<string>,
  out: Row[],
  depth: number,
): void {
  for (const node of nodes) {
    out.push({ kind: "node", node, depth });
    if (node.type === "dir") {
      const isOpen = openOverrides.get(node.path) ?? false;
      if (isOpen) {
        if (node.truncated && loadingDirs.has(node.path)) {
          out.push({ kind: "loading", path: node.path, depth: depth + 1 });
        }
        if (node.children && node.children.length > 0) {
          pushDescendants(node.children, openOverrides, loadingDirs, out, depth + 1);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Tree row (memoized)                                                 */
/* ------------------------------------------------------------------ */

interface TreeRowProps {
  row: VisibleRow;
  activePath: string | null;
  openOverrides: Map<string, boolean>;
  statusMap: Record<string, TreeGitStatus>;
  flashPath: string | null;
  onToggleDir: (node: RepoTreeNode, next: boolean) => void;
  onOpenFile: (path: string) => void;
}

const TreeRow = memo(function TreeRow({
  row,
  activePath,
  openOverrides,
  statusMap,
  flashPath,
  onToggleDir,
  onOpenFile,
}: TreeRowProps) {
  const { node, depth } = row;
  const isOpen = openOverrides.get(node.path) ?? false;
  const gitStatus = node.type === "file" ? (statusMap[node.path] ?? null) : null;
  const active = node.path === activePath;
  const flashing = flashPath === node.path;

  const content = (
    <>
      {active ? (
        <span aria-hidden="true" className="absolute left-0 h-4 w-0.5 rounded bg-primary" />
      ) : null}
      {node.type === "dir" ? (
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-90",
          )}
        />
      ) : (
        <span className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      {node.type === "dir" ? (
        <DirIcon open={isOpen} />
      ) : (
        <FileIcon name={node.name} />
      )}
      <span className="min-w-0 truncate">{node.name}</span>
      {gitStatus ? <GitStatusLetter status={gitStatus} /> : null}
    </>
  );

  const style: React.CSSProperties = { paddingLeft: 4 + depth * 12 };

  if (node.type === "file") {
    return (
      <button
        type="button"
        data-tree-row="true"
        data-node-path={node.path}
        onClick={() => onOpenFile(node.path)}
        aria-current={active ? "true" : undefined}
        title={node.path}
        style={style}
        className={cn(
          "relative flex h-7 w-full items-center gap-1 rounded pr-1 text-left text-[12px]",
          "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          active && "bg-surface-hover",
          flashing && "bg-primary/10 transition-colors",
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <button
      type="button"
      data-tree-row="true"
      data-node-path={node.path}
      onClick={() => onToggleDir(node, !isOpen)}
      aria-expanded={isOpen}
      style={style}
      className={cn(
        "flex h-7 w-full items-center gap-1 rounded pr-1 text-left text-[12px]",
        "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        flashing && "bg-primary/10 transition-colors",
      )}
    >
      {content}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Filter result row (memoized)                                        */
/* ------------------------------------------------------------------ */

interface FilterRowProps {
  path: string;
  name: string;
  match: FuzzyResult;
  active: boolean;
  gitStatus: TreeGitStatus | null;
}

const FilterResultRow = memo(function FilterResultRow({
  path,
  name,
  match,
  active,
  gitStatus,
}: FilterRowProps) {
  // Map full-path match positions onto the displayed basename when possible.
  const offset = path.length - name.length;
  const localPositions = match.positions
    .filter((p) => p >= offset)
    .map((p) => p - offset);

  return (
    <button
      type="button"
      data-tree-row="true"
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
      <FileIcon name={name} />
      <span className="min-w-0 truncate font-mono text-[11px] text-foreground/85">
        <HighlightedText text={name} positions={localPositions} />
      </span>
      <span className="ml-auto shrink-0 truncate pl-1 font-mono text-[10px] text-muted-foreground/60">
        {path.slice(0, Math.max(0, offset - 1))}
      </span>
      {gitStatus ? <GitStatusLetter status={gitStatus} /> : null}
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
  const { tree, loading, error, reload, flattened, statusNote, loadingDirs, loadDir } =
    useRepositoryTree();
  const repoRailView = useWorkspaceStore((s) => s.repoRailView);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const setExplorerOpen = useWorkspaceStore((s) => s.setExplorerOpen);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const treeReveal = useWorkspaceStore((s) => s.treeReveal);

  // Store-derived per-path git status (memoized — never a fresh object per
  // render, which would defeat zustand's equality check).
  const gitStatusMap = useMemo(() => {
    const map: Record<string, TreeGitStatus> = {};
    for (const tab of tabs) if (tab.gitStatus) map[tab.path] = tab.gitStatus;
    return map;
  }, [tabs]);

  const [filter, setFilter] = useState("");
  // Sparse open/closed overrides; absent = collapsed (depth-0 dirs start open
  // in the flat model below via the initial walk).
  const [openOverrides, setOpenOverrides] = useState<Map<string, boolean>>(() => {
    const initial = new Map<string, boolean>();
    for (const node of tree) if (node.type === "dir") initial.set(node.path, true);
    return initial;
  });
  const [flashPath, setFlashPath] = useState<string | null>(null);

  const filterRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingRevealRef = useRef<{ path: string; attempts: number } | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (filterAutoFocus) filterRef.current?.focus();
  }, [filterAutoFocus]);

  /* Keep depth-0 dirs open when the tree first arrives. */
  useEffect(() => {
    setOpenOverrides((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const node of tree) {
        if (node.type === "dir" && !next.has(node.path)) {
          next.set(node.path, true);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tree]);

  const toggleDir = useCallback(
    (node: RepoTreeNode, next: boolean) => {
      setOpenOverrides((prev) => {
        const map = new Map(prev);
        map.set(node.path, next);
        return map;
      });
      // Lazy-load truncated directories when expanded (honest server data).
      if (next && node.truncated) void loadDir(node.path);
    },
    [loadDir],
  );

  const openFile = useCallback((path: string) => {
    void editorNavigation.open({ filePath: path, sourceContext: "manual" });
  }, []);

  const query = filter.trim();
  const filtering = query.length > 0;

  const matches = useMemo(() => {
    if (!filtering) return [];
    return fuzzyFilter(flattened, (node) => node.path, query, 100);
  }, [filtering, flattened, query]);

  /* Visible rows for the virtualized list. */
  const rows = useMemo<Row[]>(() => {
    if (filtering || loading || error) return [];
    const out: Row[] = [];
    buildVisibleRows(tree, openOverrides, loadingDirs, out);
    return out;
  }, [filtering, loading, error, tree, openOverrides, loadingDirs]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  /* ---- reveal (breadcrumb clicks): expand ancestors → scroll → flash ---- */
  useEffect(() => {
    if (!treeReveal) return;
    if (filtering) setFilter("");
    pendingRevealRef.current = { path: treeReveal.path, attempts: 0 };
    const segments = treeReveal.path.split("/");
    setOpenOverrides((prev) => {
      const next = new Map(prev);
      for (let i = 1; i < segments.length; i += 1) {
        next.set(segments.slice(0, i).join("/"), true);
      }
      return next;
    });
  }, [treeReveal, filtering]);

  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending || filtering || loading) return;
    const index = rows.findIndex(
      (row) => row.kind === "node" && row.node.path === pending.path,
    );
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "center" });
      setFlashPath(pending.path);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashPath(null), 1400);
      pendingRevealRef.current = null;
      return;
    }
    // Target not visible yet — a truncated ancestor may need lazy loading.
    pending.attempts += 1;
    if (pending.attempts > 4) {
      pendingRevealRef.current = null;
      return;
    }
    const segments = pending.path.split("/");
    for (let i = segments.length - 1; i > 0; i -= 1) {
      const dirPath = segments.slice(0, i).join("/");
      const dirRow = rows.find(
        (row) => row.kind === "node" && row.node.path === dirPath,
      );
      if (dirRow && dirRow.kind === "node" && dirRow.node.truncated) {
        void loadDir(dirPath);
        break;
      }
    }
  }, [rows, filtering, loading, virtualizer, loadDir]);

  useEffect(() => {
    const timer = flashTimerRef.current;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  /* Arrow-key navigation across the currently rendered rows. */
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const container = event.currentTarget;
    const rowButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[data-tree-row]"),
    );
    if (rowButtons.length === 0) return;
    const currentIndex = rowButtons.findIndex((el) => el === document.activeElement);
    event.preventDefault();
    if (currentIndex === -1) {
      rowButtons[0]?.focus();
      return;
    }
    const nextIndex =
      event.key === "ArrowDown"
        ? Math.min(currentIndex + 1, rowButtons.length - 1)
        : Math.max(currentIndex - 1, 0);
    rowButtons[nextIndex]?.focus();
  }, []);

  const totalHeight = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();

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

      {/* Honest git-status note (never fabricated) */}
      {statusNote ? (
        <p className="shrink-0 px-2 pb-1 text-[10px] leading-snug text-muted-foreground/70">
          {statusNote}
        </p>
      ) : null}

      {/* Body — virtualized both for tree rows and fuzzy results */}
      <div
        ref={scrollRef}
        aria-busy={loading}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto p-1"
      >
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
            <>
              <p className="px-1 pb-1 text-[10px] text-muted-foreground/70">
                {matches.length} {matches.length === 1 ? "match" : "matches"} — fuzzy scored
              </p>
              <div className="space-y-0.5" aria-label="Matching files">
                  {matches.map(({ item, match }) => (
                    <FilterResultRow
                      key={item.path}
                      path={item.path}
                      name={item.name}
                      match={match}
                      active={item.path === activeTabPath}
                      gitStatus={gitStatusMap[item.path] ?? null}
                    />
                  ))}
                </div>
            </>
          )
        ) : tree.length === 0 ? (
          <CenteredNote>
            <p className="text-[12px] text-muted-foreground">No files</p>
          </CenteredNote>
        ) : (
          <div className="relative" style={{ height: totalHeight }}>
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <div
                  key={row.kind === "node" ? row.node.path : `loading-${row.path}`}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full px-0.5"
                  style={{ height: ROW_HEIGHT, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="ml-2.5 border-l border-transparent pl-0" style={{ marginLeft: 0 }}>
                    {row.kind === "node" ? (
                      <FileContextMenu path={row.node.path} isDir={row.node.type === "dir"}>
                        <TreeRow
                          row={row}
                          activePath={activeTabPath}
                          openOverrides={openOverrides}
                          statusMap={gitStatusMap}
                          flashPath={flashPath}
                          onToggleDir={toggleDir}
                          onOpenFile={openFile}
                        />
                      </FileContextMenu>
                    ) : (
                      <div
                        style={{ paddingLeft: 8 }}
                        className="flex h-7 items-center gap-2"
                        aria-label={`Loading ${row.path}`}
                      >
                        <Skeleton className="h-3 w-2/3 rounded" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
