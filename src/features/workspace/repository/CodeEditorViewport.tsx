"use client";

/**
 * CodeMind X V2 — code editor viewport (Phase 5, read-only preview).
 *
 * Renders the ACTIVE tab with honest status states only:
 *   none / loading / missing / binary / too-large / error (retry) / ready.
 *
 * Phase 2 core preserved: header (path, language, line count, truncation,
 * copy), scrollable line-numbered preview contained to the panel, honest
 * read-only footer, single-line navigation highlight.
 *
 * Phase 5 (spec §3/§4/§7/§9):
 * - Breadcrumbs above the header; directory segments reveal in the tree.
 * - File metadata header: git status badge, branch@shortSha, last-modified
 *   (relative), auto-classification badge (informational, V2.1 §A).
 * - Multi-line range highlight from editor navigation payloads.
 * - Binary view: real metadata + safe image preview + download (no binary
 *   rendered as source, ever).
 */

import { memo, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy, Download, FileCode2 } from "lucide-react";

import type { FileProvenanceMeta } from "@/features/workspace/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

import { Breadcrumbs } from "./Breadcrumbs";

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
/* Line row (memoized)                                                 */
/* ------------------------------------------------------------------ */

const CodeLine = memo(function CodeLine({
  number,
  text,
  highlighted,
  inRange,
}: {
  number: number;
  text: string;
  highlighted: boolean;
  inRange: boolean;
}) {
  return (
    <div
      data-line={number}
      className={cn(
        "flex w-max min-w-full",
        (highlighted || inRange) && "bg-primary/10",
        inRange && !highlighted && "border-l-2 border-primary/30",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "sticky left-0 z-[1] w-10 shrink-0 select-none border-l-2 pr-2 text-right font-mono text-[10.5px] leading-[1.65]",
          highlighted
            ? "border-primary bg-primary/10 text-primary"
            : inRange
              ? "border-primary/40 bg-primary/10 text-foreground/70"
              : "border-transparent bg-surface text-muted-foreground/50",
        )}
      >
        {number}
      </span>
      <span className="whitespace-pre pr-4 font-mono text-[11.5px] leading-[1.65] text-foreground/90">
        {text.length === 0 ? "\u00A0" : text}
      </span>
    </div>
  );
});

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

export function CodeEditorViewport({ line, range, meta }: CodeEditorViewportProps) {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const setTabStatus = useWorkspaceStore((s) => s.setTabStatus);
  const revealInTree = useWorkspaceStore((s) => s.revealInTree);
  const reducedMotion = useReducedMotion();

  const activeTab = activeTabPath
    ? tabs.find((t) => t.path === activeTabPath)
    : undefined;
  const status = activeTab?.status;

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);

  // React Compiler memoizes this derivation; manual useMemo is rejected here
  // because the store-derived object cannot be proven immutable.
  const lines = activeTab?.content ? activeTab.content.split("\n") : [];

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

  /* Scroll the target (line, else range start) into view — once per change.
     Manual math so only THIS scroll container moves. */
  const targetLine =
    line ?? (range && Number.isFinite(range.startLine) ? Math.floor(range.startLine) : undefined);
  const rangeStart = range && Number.isFinite(range.startLine) ? Math.floor(range.startLine) : undefined;
  const rangeEnd =
    range && Number.isFinite(range.endLine) ? Math.max(rangeStart ?? 0, Math.floor(range.endLine)) : undefined;

  useEffect(() => {
    if (!targetLine) return;
    const container = bodyRef.current;
    if (!container) return;
    const row = container.querySelector<HTMLElement>(`[data-line="${targetLine}"]`);
    if (!row) return;
    const top = row.offsetTop - container.clientHeight / 2 + row.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? "auto" : "smooth" });
  }, [targetLine, reducedMotion, status, activeTabPath]);

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

  /* status === "ready" */
  const language = meta?.language ?? inferLanguage(activeTab.path);
  const provenance = meta?.provenance;
  const gitBadge = activeTab.gitStatus ? GIT_BADGE[activeTab.gitStatus] : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {breadcrumbs}

      {/* Header — real file metadata only (spec §3); unknown stays hidden. */}
      <header className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto border-b border-border-subtle px-2.5 text-[11px] text-muted-foreground [scrollbar-width:none]">
        <span className="min-w-0 shrink-0 truncate font-mono" title={activeTab.path}>
          {activeTab.path}
        </span>
        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
          {language}
        </Badge>
        <span className="shrink-0 tabular-nums">{lines.length} lines</span>
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
      </header>

      {/* Body — both axes scroll INSIDE this panel; page overflow impossible */}
      <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-auto bg-surface">
        <div role="figure" aria-label={`Preview of ${activeTab.path}`}>
          {lines.map((text, index) => {
            const number = index + 1;
            const isExactTarget = line === number;
            const inRange =
              rangeStart !== undefined &&
              rangeEnd !== undefined &&
              number >= rangeStart &&
              number <= rangeEnd;
            return (
              <CodeLine
                key={number}
                number={number}
                text={text}
                highlighted={isExactTarget}
                inRange={inRange}
              />
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <footer className="flex h-6 shrink-0 items-center gap-1 border-t border-border-subtle px-2.5 text-[10px] text-muted-foreground">
        Read-only preview — rich editor (Monaco) arrives in a later phase.
      </footer>
    </div>
  );
}
