"use client";

/**
 * CodeMind X V2 — code editor viewport (Phase 2, read-only preview).
 *
 * Renders the ACTIVE tab with honest status states only:
 *   none / loading / missing / binary / too-large / error (retry) / ready.
 *
 * Ready view: header (path, language, real line count, truncation notice,
 * copy), a scrollable line-numbered preview (both axes contained — the page
 * can never overflow), and an honest read-only footer. The Monaco rich editor
 * is a later phase; nothing here pretends otherwise.
 *
 * `line` (1-based) is the target line from the last editor navigation payload
 * for the active tab: the row is highlighted and scrolled into view once per
 * line change (smooth unless the user prefers reduced motion).
 */

import { memo, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { Check, Copy, FileCode2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

export interface CodeFileMeta {
  language?: string;
  truncated?: boolean;
  size?: number;
}

export interface CodeEditorViewportProps {
  /** 1-based target line from the last editor navigation for the active tab. */
  line?: number;
  /** Real metadata captured from the file API response (language/truncated). */
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

/* ------------------------------------------------------------------ */
/* Line row (memoized)                                                 */
/* ------------------------------------------------------------------ */

const CodeLine = memo(function CodeLine({
  number,
  text,
  highlighted,
}: {
  number: number;
  text: string;
  highlighted: boolean;
}) {
  return (
    <div
      data-line={number}
      className={cn("flex w-max min-w-full", highlighted && "bg-primary/10")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "sticky left-0 z-[1] w-10 shrink-0 select-none border-l-2 pr-2 text-right font-mono text-[10.5px] leading-[1.65]",
          highlighted
            ? "border-primary bg-primary/10 text-primary"
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

export function CodeEditorViewport({ line, meta }: CodeEditorViewportProps) {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const setTabStatus = useWorkspaceStore((s) => s.setTabStatus);
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

  /* Scroll the target line into view — once per line change. Manual math so
     only THIS scroll container moves (scrollIntoView could scroll ancestors). */
  useEffect(() => {
    if (!line) return;
    const container = bodyRef.current;
    if (!container) return;
    const row = container.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (!row) return;
    const top = row.offsetTop - container.clientHeight / 2 + row.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? "auto" : "smooth" });
  }, [line, reducedMotion, status, activeTabPath]);

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

  if (status === "loading" || !status) {
    return (
      <div aria-busy="true" className="flex h-full min-h-0 flex-col">
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
        <StatusNotice title="Binary file — preview not available." />
      </div>
    );
  }

  if (status === "too-large") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <StatusNotice title="File exceeds the 512 KB preview limit." />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-full min-h-0 flex-col">
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle px-2.5 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate font-mono" title={activeTab.path}>
          {activeTab.path}
        </span>
        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
          {language}
        </Badge>
        <span className="shrink-0 tabular-nums">{lines.length} lines</span>
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
            return (
              <CodeLine
                key={number}
                number={number}
                text={text}
                highlighted={line === number}
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
