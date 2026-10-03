"use client";

/**
 * CodeMind X V2 — focused Repository destination view (main area).
 *
 * A lightweight repository PAGE — real meta, real file browser, read-only
 * file preview — used when the "Repository" destination is active. It is
 * intentionally NOT the four-panel VSCode-style workspace: that chrome is
 * Assistant-scoped (user request). Nothing here is simulated:
 * - meta from GET /api/repository/meta (via useRepositoryMeta)
 * - tree from GET /api/repository/tree (via useRepositoryTree)
 * - preview from GET /api/repository/file?path=…
 *
 * The layout is responsive: side-by-side browser + preview from `lg`, and a
 * single scrolling column below that. Long paths wrap/truncate cleanly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Braces,
  File as FileIcon,
  FileWarning,
  FolderGit2,
  GitBranch,
  RefreshCw,
  SearchX,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { useRepositoryMeta } from "../use-repository-meta";
import type { RepoFile, RepoTreeNode } from "../types";
import { useRepositoryTree } from "../repository/use-repository-tree";
import { ImportRepositoryButton } from "../repository/ImportDialog";

/* ------------------------------------------------------------------ */
/* File preview                                                        */
/* ------------------------------------------------------------------ */

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading"; path: string }
  | { kind: "ready"; file: RepoFile }
  | { kind: "missing"; path: string }
  | { kind: "too-large"; path: string }
  | { kind: "binary"; path: string }
  | { kind: "error"; path: string; message: string };

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Last path segment — a display name for tree rows. */
function baseName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function PreviewPane({ state }: { state: PreviewState }) {
  if (state.kind === "idle") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Braces aria-hidden="true" className="size-6 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">Select a file to preview it</p>
        <p className="max-w-64 text-xs leading-relaxed text-muted-foreground/70">
          Read-only preview served by the real repository file API. The editable
          workspace lives on the Assistant page.
        </p>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="flex h-full flex-col gap-2 p-4" role="status" aria-label={`Loading ${state.path}`}>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (state.kind === "ready") {
    const { file } = state;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-2">
          <span
            className="min-w-0 break-all font-mono text-xs text-foreground/90"
            title={file.path}
          >
            {file.path}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded border border-border-subtle px-1.5 py-0.5 font-mono">
              {file.language}
            </span>
            <span>{formatBytes(file.size)}</span>
            {file.truncated && (
              <span className="flex items-center gap-1 text-warning">
                <FileWarning aria-hidden="true" className="size-3" />
                truncated
              </span>
            )}
          </span>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground/90">
          <code>{file.content}</code>
        </pre>
      </div>
    );
  }

  const messages: Record<Exclude<PreviewState["kind"], "idle" | "loading" | "ready">, string> = {
    missing: "This file is not available through the repository service.",
    "too-large": "This file exceeds the preview size limit.",
    binary: "Binary files have no text preview.",
    error: (state as { message?: string }).message ?? "The file could not be loaded.",
  };
  const title =
    state.kind === "error" ? "Preview failed" : "No preview available";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <AlertTriangle aria-hidden="true" className="size-6 text-warning" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-72 break-all text-xs text-muted-foreground">
        {messages[state.kind]}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function RepositoryOverviewPanel() {
  const { meta, loading: metaLoading } = useRepositoryMeta();
  const { tree, loading: treeLoading, error: treeError, reload, flattened } =
    useRepositoryTree();

  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });

  const inflightRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = inflightRef.current;
    return () => controller?.abort();
  }, []);

  const openFile = useCallback((path: string) => {
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;
    setPreview({ kind: "loading", path });

    fetch(`/api/repository/file?path=${encodeURIComponent(path)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { ok?: boolean; file?: RepoFile }
            | null;
          if (data?.ok === true && data.file) {
            setPreview({ kind: "ready", file: data.file });
            return;
          }
          setPreview({
            kind: "error",
            path,
            message: "The file service returned an unexpected response.",
          });
          return;
        }
        if (res.status === 403 || res.status === 404) {
          setPreview({ kind: "missing", path });
        } else if (res.status === 413) {
          setPreview({ kind: "too-large", path });
        } else if (res.status === 415) {
          setPreview({ kind: "binary", path });
        } else {
          setPreview({
            kind: "error",
            path,
            message: `The file service responded with HTTP ${res.status}.`,
          });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setPreview({
          kind: "error",
          path,
          message:
            err instanceof Error && err.name !== "AbortError"
              ? err.message
              : "The file service is unreachable right now.",
        });
      });
  }, []);

  /* Flattened, filtered file rows — real server order, honest empty state. */
  const trimmed = filter.trim().toLowerCase();
  const files = useMemo(
    () =>
      trimmed
        ? flattened.filter((n) => n.path.toLowerCase().includes(trimmed))
        : flattened,
    [flattened, trimmed],
  );

  const branch = meta?.repository.branch ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* Header — real meta only */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border-subtle px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <FolderGit2 aria-hidden="true" className="size-4 text-primary" />
          Repository
        </span>
        {metaLoading ? (
          <Skeleton className="h-4 w-40" />
        ) : (
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="max-w-[240px] truncate text-foreground/90">
              {meta?.repository.name ?? "Not connected"}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <GitBranch aria-hidden="true" className="size-3" />
              {branch ?? "no branch"}
            </span>
          </span>
        )}
        <span className="text-[11px] text-muted-foreground/70">
          Indexing unavailable — arrives in a later phase.
        </span>
        <span className="ml-auto">
          <ImportRepositoryButton />
        </span>
      </header>

      {/* Body — browser + preview */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* File browser */}
        <div className="flex min-h-40 shrink-0 flex-col border-b border-border-subtle lg:h-full lg:w-[38%] lg:min-w-[240px] lg:max-w-[420px] lg:border-b-0 lg:border-r">
          <div className="flex shrink-0 items-center gap-2 p-2">
            <input
              type="text"
              role="searchbox"
              aria-label="Filter files"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter files…"
              className="h-8 w-full min-w-0 rounded-md border border-border-subtle bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
            />
            <button
              type="button"
              aria-label="Reload file tree"
              onClick={reload}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
            >
              <RefreshCw aria-hidden="true" className="size-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" style={{ maxHeight: "100%" }}>
            {treeLoading ? (
              <div className="space-y-1.5 p-2" role="status" aria-label="Loading files">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : treeError ? (
              <div className="flex flex-col items-center gap-1.5 p-4 text-center">
                <AlertTriangle aria-hidden="true" className="size-4 text-warning" />
                <p className="text-xs text-muted-foreground">
                  The file tree could not be loaded.
                </p>
              </div>
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 p-4 text-center">
                <SearchX aria-hidden="true" className="size-4 text-muted-foreground/60" />
                <p className="text-xs text-muted-foreground">
                  {trimmed ? "No files match this filter" : "No files in the workspace tree"}
                </p>
              </div>
            ) : (
              <ul className="space-y-0.5" aria-label="Workspace files">
                {files.map((node: RepoTreeNode) => {
                  const active =
                    preview.kind === "ready" && preview.file.path === node.path;
                  return (
                    <li key={node.path}>
                      <button
                        type="button"
                        onClick={() => openFile(node.path)}
                        aria-current={active ? "true" : undefined}
                        title={node.path}
                        className={cn(
                          "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60",
                          active
                            ? "bg-primary/15 text-primary"
                            : "text-foreground/85 hover:bg-surface-hover hover:text-foreground",
                        )}
                      >
                        <FileIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate">{baseName(node.path)}</span>
                        <span className="ml-auto hidden min-w-0 truncate font-mono text-[10px] text-muted-foreground/60 xl:block xl:max-w-[45%]">
                          {node.path}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="min-h-48 min-w-0 flex-1 lg:min-h-0">
          <PreviewPane state={preview} />
        </div>
      </div>
    </div>
  );
}
