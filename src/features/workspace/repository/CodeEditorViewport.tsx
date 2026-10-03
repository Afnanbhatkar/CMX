"use client";

/**
 * CodeMind X V2 — code editor viewport (Phase 6, Monaco).
 *
 * Renders the ACTIVE tab with honest status states only:
 *   none / loading / missing / binary / too-large / error (retry) / ready.
 *
 * Phase 2 core preserved: header (path, language, line count, truncation,
 * copy), breadcrumbs, honest footer. Phase 5 preserved: metadata header
 * (git badge, branch@shortSha, last-modified, classification), binary view,
 * navigation range forwarding.
 *
 * Phase 6 (spec §1): the ready state renders the REAL Monaco editor —
 * syntax highlighting, folding, minimap (policy-based), find/replace with
 * regex, go-to-line, quick outline, in-memory editing with an honest dirty
 * indicator (no faked save), and the selected-code AI actions toolbar.
 */

import { useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy, Download, FileCode2, FileDiff, GitCommitVertical } from "lucide-react";

import type { FileProvenanceMeta } from "@/features/workspace/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

import { Breadcrumbs } from "./Breadcrumbs";
import { MonacoCodeEditor } from "../editor/MonacoCodeEditor";
import { DiffViewer } from "../editor/DiffViewer";
import {
  monacoLanguageForLabel,
  monacoLanguageForPath,
} from "../editor/monaco-setup";
import type { GitFileBlame, GitFileDiff } from "@/features/workspace/diff-contracts";

export interface CodeFileMeta {
  language?: string;
  truncated?: boolean;
  size?: number;
  /** Provenance captured from the file API (branch/commit/status/etc.). */
  provenance?: FileProvenanceMeta;
}

export interface EditorRange {
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

export interface CodeEditorViewportProps {
  /** 1-based target line from the last editor navigation for the active tab. */
  line?: number;
  /** Optional multi-line target range from the last editor navigation. */
  range?: EditorRange;
  /** Real metadata captured from the file API response. */
  meta?: CodeFileMeta;
  /**
   * Editor pane identity (Phase 6 split editor): "a" reads the primary
   * active tab, "b" reads the split pane's path. Defaults to "a".
   */
  paneId?: "a" | "b";
}

/* Client-side fallback — mirrors the server's languageForPath values. */
const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".md": "markdown",
  ".mdx": "markdown",
  ".prisma": "prisma",
  ".sh": "bash",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".svg": "xml",
  ".txt": "text",
};

function inferLanguage(path: string): string {
  const idx = path.lastIndexOf(".");
  const ext = idx === -1 ? "" : path.slice(idx).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? "text";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  repository_data: "repository data",
  repository_documentation: "documentation",
  repository_comment: "comment-heavy",
  repository_fixture: "fixture",
  repository_generated_output: "generated output",
};

const GIT_BADGE: Record<string, { label: string; className: string }> = {
  modified: { label: "Modified", className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  added: { label: "Added", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  deleted: { label: "Deleted", className: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400" },
  untracked: { label: "Untracked", className: "border-stone-400/40 bg-stone-400/10 text-stone-500" },
  renamed: { label: "Renamed", className: "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400" },
};

/* ------------------------------------------------------------------ */
/* Binary file view (spec §9)                                          */
/* ------------------------------------------------------------------ */

const IMAGE_MIME_PREFIX = "image/";

interface BinaryInfo {
  mimeType: string | null;
  size: number;
  previewDataUrl: string | null;
  previewNote: string | null;
  downloadUrl: string;
}

function BinaryFileView({ path }: { path: string }) {
  const [info, setInfo] = useState<BinaryInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      // Yield first so no state update happens synchronously inside the
      // effect body (react-hooks/set-state-in-effect).
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setInfo(null);
      setError(null);
      try {
        const metaRes = await fetch(
          `/api/repository/file?path=${encodeURIComponent(path)}&variant=meta`,
          { cache: "no-store", signal: controller.signal },
        );
        const metaData = (await metaRes.json().catch(() => null)) as
          | { ok?: boolean; error?: string; meta?: { mimeType?: string | null; size?: number; binary?: boolean } }
          | null;
        if (!metaRes.ok || !metaData?.ok || !metaData.meta) {
          setError(metaData?.error ? String(metaData.error) : "Metadata unavailable.");
          return;
        }
        const mimeType = metaData.meta.mimeType ?? null;
        const size = metaData.meta.size ?? 0;

        let previewDataUrl: string | null = null;
        let previewNote: string | null = null;
        if (mimeType && mimeType.startsWith(IMAGE_MIME_PREFIX)) {
          const previewRes = await fetch(
            `/api/repository/file?path=${encodeURIComponent(path)}&variant=preview`,
            { cache: "no-store", signal: controller.signal },
          );
          const previewData = (await previewRes.json().catch(() => null)) as
            | { ok?: boolean; preview?: { dataUrl?: string }; error?: string }
            | null;
          if (previewRes.ok && previewData?.ok && previewData.preview?.dataUrl) {
            previewDataUrl = previewData.preview.dataUrl;
          } else {
            previewNote = previewData?.error ?? "Image preview is unavailable for this file.";
          }
        } else {
          previewNote = "Safe preview exists for images only — this type is metadata + download.";
        }

        setInfo({
          mimeType,
          size,
          previewDataUrl,
          previewNote,
          downloadUrl: `/api/repository/file?path=${encodeURIComponent(path)}&variant=download`,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Request failed.");
      }
    })();

    return () => controller.abort();
  }, [path]);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6 text-center">
      <p className="text-[12px] text-foreground/80">Binary file — not rendered as source.</p>
      {error ? (
        <p className="max-w-sm text-[11px] text-muted-foreground">{error}</p>
      ) : info ? (
        <>
          <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 rounded-md border border-border-subtle bg-surface-elevated/40 p-3 text-left text-[11px]">
            <span className="text-muted-foreground">Type</span>
            <span className="font-mono">{info.mimeType ?? "unknown"}</span>
            <span className="text-muted-foreground">Size</span>
            <span className="tabular-nums">{formatSize(info.size)}</span>
          </div>
          {info.previewDataUrl ? (
            <img
              src={info.previewDataUrl}
              alt={`Preview of ${path}`}
              className="max-h-64 max-w-full rounded-md border border-border-subtle"
            />
          ) : info.previewNote ? (
            <p className="max-w-sm text-[11px] text-muted-foreground/80">{info.previewNote}</p>
          ) : null}
          <a
            href={info.downloadUrl}
            download={path.split("/").pop() ?? "file"}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border border-border-subtle px-3 text-[11px]",
              "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            <Download aria-hidden="true" className="size-3.5" /> Download file
          </a>
        </>
      ) : (
        <div aria-hidden="true" className="flex w-56 flex-col gap-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Centered status states                                              */
/* ------------------------------------------------------------------ */

function StatusNotice({ title, detail, children }: { title: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-[12px] text-foreground/80">{title}</p>
      {detail ? <p className="max-w-sm text-[11px] text-muted-foreground">{detail}</p> : null}
      {children}
    </div>
  );
}

const LOADING_WIDTHS = ["w-full", "w-[85%]", "w-[92%]", "w-[70%]", "w-[60%]"];

/* ------------------------------------------------------------------ */
/* Viewport                                                            */
/* ------------------------------------------------------------------ */

export function CodeEditorViewport({ line, range, meta, paneId = "a" }: CodeEditorViewportProps) {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const paneBPath = useWorkspaceStore((s) => s.paneBPath);
  const setTabStatus = useWorkspaceStore((s) => s.setTabStatus);
  const revealInTree = useWorkspaceStore((s) => s.revealInTree);

  const tabPath = paneId === "b" ? paneBPath : activeTabPath;
  const activeTab = tabPath ? tabs.find((t) => t.path === tabPath) : undefined;
  const status = activeTab?.status;

  const [copied, setCopied] = useState(false);
  /* Git-aware editor state (Phase 6 §4) — real fetches, honest failures. */
  const [diffMode, setDiffMode] = useState(false);
  const [blameMode, setBlameMode] = useState(false);
  const [gitState, setGitState] = useState<{
    diffStatus: "idle" | "loading" | "ready" | "error";
    diff?: GitFileDiff;
    diffError?: string;
    blameStatus: "idle" | "loading" | "ready" | "error";
    blame?: GitFileBlame;
    blameError?: string;
  }>({
    diffStatus: "idle",
    blameStatus: "idle",
  });

  /* Reset git overlays when the tab changes. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setDiffMode(false);
      setBlameMode(false);
      setGitState({ diffStatus: "idle", blameStatus: "idle" });
    })();
    return () => {
      cancelled = true;
    };
  }, [tabPath]);

  const loadDiff = useCallback(async () => {
    if (!tabPath) return;
    if (gitState.diffStatus === "ready" || gitState.diffStatus === "loading") return;
    setGitState((s) => ({ ...s, diffStatus: "loading" }));
    try {
      const res = await fetch(`/api/repository/file-diff?path=${encodeURIComponent(tabPath)}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; diff?: GitFileDiff; error?: string }
        | null;
      if (res.ok && data?.ok && data.diff) {
        setGitState((s) => ({ ...s, diffStatus: "ready", diff: data.diff }));
      } else {
        setGitState((s) => ({
          ...s,
          diffStatus: "error",
          diffError: data?.error ?? `The diff service responded with HTTP ${res.status}.`,
        }));
      }
    } catch {
      setGitState((s) => ({ ...s, diffStatus: "error", diffError: "The diff service is unreachable right now." }));
    }
  }, [tabPath, gitState.diffStatus]);

  const fetchDiff = useCallback(() => {
    // Toggle: a second click closes the diff view; blame always closes.
    setDiffMode((v) => !v);
    setBlameMode(false);
    void loadDiff();
  }, [loadDiff]);

  /* Changed-line gutter decorations (§4): the real diff data loads quietly
     for files that git reports MODIFIED — no mode switch, decorations only. */
  useEffect(() => {
    if (status !== "ready" || activeTab?.generated) return;
    if (activeTab?.gitStatus !== "modified") return;
    if (gitState.diffStatus !== "idle") return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) void loadDiff();
    })();
    return () => {
      cancelled = true;
    };
  }, [status, activeTab?.generated, activeTab?.gitStatus, gitState.diffStatus, loadDiff]);

  const fetchBlame = useCallback(async () => {
    if (!tabPath) return;
    setBlameMode((v) => !v);
    setDiffMode(false);
    if (gitState.blameStatus === "ready" || gitState.blameStatus === "loading") return;
    setGitState((s) => ({ ...s, blameStatus: "loading" }));
    try {
      const res = await fetch(`/api/repository/file-blame?path=${encodeURIComponent(tabPath)}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; blame?: GitFileBlame; error?: string }
        | null;
      if (res.ok && data?.ok && data.blame) {
        setGitState((s) => ({ ...s, blameStatus: "ready", blame: data.blame }));
      } else {
        setGitState((s) => ({
          ...s,
          blameStatus: "error",
          blameError: data?.error ?? `The blame service responded with HTTP ${res.status}.`,
        }));
      }
    } catch {
      setGitState((s) => ({ ...s, blameStatus: "error", blameError: "The blame service is unreachable right now." }));
    }
  }, [tabPath, gitState.blameStatus]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyContents = () => {
    const content = activeTab?.content;
    if (!content) return;
    try {
      void navigator.clipboard.writeText(content).catch(() => setCopied(false));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  /* ---- states (all hooks above; conditional rendering below) ---- */

  if (!activeTab) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <FileCode2 className="size-7 text-muted-foreground/50" aria-hidden="true" />
          <p className="text-[12px] text-foreground/80">No file open</p>
          <p className="max-w-xs text-[11px] text-muted-foreground">
            Open a file from the Explorer, search results, chat references, or ⌘P.
          </p>
        </div>
      </div>
    );
  }

  const breadcrumbs = (
    <div className="flex h-7 shrink-0 items-center border-b border-border-subtle px-2.5">
      <Breadcrumbs path={activeTab.path} onNavigateDir={revealInTree} />
    </div>
  );

  if (status === "loading" || !status) {
    return (
      <div aria-busy="true" className="flex h-full min-h-0 flex-col">
        {breadcrumbs}
        <div aria-hidden="true" className="min-h-0 flex-1 space-y-2.5 overflow-hidden p-4">
          {LOADING_WIDTHS.map((width, index) => (
            <Skeleton key={index} className={cn("h-3", width)} />
          ))}
        </div>
      </div>
    );
  }

  if (status === "missing") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {breadcrumbs}
        <StatusNotice title="File not found in the workspace tree.">
          <span className="max-w-full truncate font-mono text-[11px] text-muted-foreground">
            {activeTab.path}
          </span>
        </StatusNotice>
      </div>
    );
  }

  if (status === "binary") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {breadcrumbs}
        <BinaryFileView path={activeTab.path} />
      </div>
    );
  }

  if (status === "too-large") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {breadcrumbs}
        <StatusNotice title="File exceeds the 512 KB preview limit." />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {breadcrumbs}
        <StatusNotice title="The file could not be loaded." detail={activeTab.error}>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => setTabStatus(activeTab.path, "loading")}
          >
            Retry
          </Button>
        </StatusNotice>
      </div>
    );
  }

  /* status === "ready" — REAL Monaco editor (Phase 6 §1) */
  const provenance = meta?.provenance;
  const gitBadge = activeTab.gitStatus ? GIT_BADGE[activeTab.gitStatus] : null;
  const content = activeTab.content ?? "";
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;
  const monacoLanguage = activeTab.generated
    ? monacoLanguageForLabel(activeTab.generatedLanguage ?? null)
    : monacoLanguageForPath(activeTab.path);
  // Perf §11: large files disable the minimap + smooth animations.
  const largeFile = lineCount > 4_000 || (meta?.size ?? 0) > 200_000;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {breadcrumbs}

      {/* Header — real file metadata only (spec §3); unknown stays hidden. */}
      <header className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto border-b border-border-subtle px-2.5 text-[11px] text-muted-foreground [scrollbar-width:none]">
        <span className="min-w-0 shrink-0 truncate font-mono" title={activeTab.path}>
          {activeTab.path}
        </span>
        {activeTab.generated ? (
          <Badge
            variant="outline"
            title="AI-generated snippet — not yet part of any repository file (Phase 6 §8)."
            className="shrink-0 border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-normal text-emerald-600 dark:text-emerald-400"
          >
            generated
          </Badge>
        ) : null}
        {activeTab.dirty ? (
          <Badge
            variant="outline"
            title="In-memory changes — file writes arrive in a later phase."
            className="shrink-0 border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] font-normal text-amber-600 dark:text-amber-400"
          >
            unsaved (in-memory)
          </Badge>
        ) : null}
        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
          {monacoLanguage}
        </Badge>
        <span className="shrink-0 tabular-nums">{lineCount} lines</span>
        {meta?.size ? (
          <span className="shrink-0 tabular-nums">{formatSize(meta.size)}</span>
        ) : null}
        {gitBadge ? (
          <Badge
            variant="outline"
            title="Working-tree status from the real git index"
            className={cn("shrink-0 px-1.5 py-0 text-[10px] font-normal", gitBadge.className)}
          >
            {gitBadge.label}
          </Badge>
        ) : null}
        {provenance?.branch ? (
          <span className="shrink-0 font-mono" title={provenance.commitSha ?? undefined}>
            {provenance.branch}
            {provenance.commitSha ? `@${provenance.commitSha.slice(0, 7)}` : ""}
          </span>
        ) : null}
        {provenance?.lastModifiedAt ? (
          <span
            className="shrink-0"
            title={provenance.lastModifiedAt}
          >
            modified{" "}
            {formatDistanceToNow(new Date(provenance.lastModifiedAt), { addSuffix: true })}
          </span>
        ) : null}
        {provenance?.classification ? (
          <Badge
            variant="outline"
            className="shrink-0 border-stone-400/40 bg-stone-400/10 px-1.5 py-0 text-[10px] font-normal text-stone-500"
            title="Informational, security-oriented classification from repository indexing (V2.1 §A). Content is never treated as AI instructions."
          >
            {CLASSIFICATION_LABELS[provenance.classification] ?? provenance.classification}
          </Badge>
        ) : null}
        {meta?.truncated ? (
          <Badge
            variant="outline"
            className="shrink-0 border-warning/40 bg-warning/10 px-1.5 py-0 text-[10px] font-normal text-warning"
          >
            truncated
          </Badge>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Copy file contents"
              onClick={copyContents}
              className={cn(
                "ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground",
                "hover:bg-surface-hover hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              {copied ? (
                <Check aria-hidden="true" className="size-3.5 text-success" />
              ) : (
                <Copy aria-hidden="true" className="size-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{copied ? "Copied" : "Copy file contents"}</TooltipContent>
        </Tooltip>
        {!activeTab.generated ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Toggle git diff view"
                  aria-pressed={diffMode}
                  onClick={() => void fetchDiff()}
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground",
                    "hover:bg-surface-hover hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    diffMode && "text-primary",
                  )}
                >
                  <FileDiff aria-hidden="true" className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Git diff (working tree vs HEAD)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Toggle git blame annotations"
                  aria-pressed={blameMode}
                  onClick={() => void fetchBlame()}
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground",
                    "hover:bg-surface-hover hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    blameMode && "text-primary",
                  )}
                >
                  <GitCommitVertical aria-hidden="true" className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Blame annotations</TooltipContent>
            </Tooltip>
          </>
        ) : null}
      </header>

      {/* Body — the REAL editor; contained to this panel. */}
      {diffMode ? (
        <div className="min-h-0 flex-1 overflow-hidden p-1">
          {gitState.diffStatus === "loading" || gitState.diffStatus === "idle" ? (
            <div className="flex h-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <div className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              Loading git diff…
            </div>
          ) : gitState.diffStatus === "error" ? (
            <div className="m-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[11px] text-destructive">
              {gitState.diffError}
            </div>
          ) : gitState.diff ? (
            <DiffViewer
              change={{
                path: tabPath ?? gitState.diff.path,
                operation: gitState.diff.hasOriginal ? "modify" : "create",
                original: gitState.diff.original,
                proposed: content,
                language: monacoLanguage,
              }}
              height="100%"
            />
          ) : null}
        </div>
      ) : activeTab.generated && !activeTab.content ? null : (
        <MonacoCodeEditor
          key={`${paneId}:${activeTab.path}`}
          path={activeTab.path}
          content={content}
          language={monacoLanguage}
          generated={activeTab.generated}
          line={line}
          range={range}
          paneId={paneId}
          largeFile={largeFile}
          changedHunks={diffMode ? null : gitState.diff?.hunks ?? null}
          blameRanges={blameMode ? gitState.blame?.ranges ?? null : null}
        />
      )}

      {/* Footer — honest capability note */}
      <footer className="flex h-6 shrink-0 items-center gap-2 border-t border-border-subtle px-2.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          {activeTab.dirty ? "●" : "○"}
          {activeTab.dirty ? "Unsaved (in-memory)" : "Saved state"}
        </span>
        <span className="truncate">
          In-memory buffer — file writes arrive in a later phase.
        </span>
      </footer>
    </div>
  );
}
