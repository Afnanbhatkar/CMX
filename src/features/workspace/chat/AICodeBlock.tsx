"use client";

/**
 * CodeMind X V2 — AI code block (Phase 6 §7/§8/§9; Phase 8.5 §6 upgrade).
 *
 * The ONE high-quality renderer for AI code. Header always shows the real
 * language + copy; everything else is CONTEXTUAL (never all visible):
 * - Expand/collapse for long snippets;
 * - Download;
 * - Word-wrap toggle (8.5);
 * - Preview — only for HTML/CSS/JS/JSX, rendered inside a sandboxed iframe
 *   (sandbox="allow-scripts", no same-origin — generated code never runs in
 *   the production window);
 * - Open in Editor — with a `// file: <path>` reference (or structured
 *   filename) opens THAT file through the EditorNavigationService; without
 *   one it opens an honest, clearly-badged GENERATED scratch tab;
 * - Review Diff — only with a file reference; shows a real Monaco diff of
 *   the loaded file content vs the snippet via the shared DiffViewer;
 * - Apply — only with a file reference; DISABLED with the honest reason
 *   (file writes require the visible-diff approval flow). Nothing is faked.
 *
 * 8.5 §6 additions:
 * - Header carries filename · language · line range · status (Generated /
 *   Modified + verified-file dot), sourced from the typed structured
 *   payload — never guessed from the markdown body;
 * - Line numbers + line highlighting (structured highlightLines);
 * - Worker-based token highlighting for long blocks (useCodeHighlight) —
 *   plain text fallback, code is always visible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FileDiff,
  FilePlus2,
  PlaySquare,
  WrapText,
} from "lucide-react";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import type { FileChange } from "@/features/workspace/diff-contracts";
import { DiffViewer } from "@/features/workspace/editor/DiffViewer";
import { buildPreviewDocument, previewKindForLanguage } from "@/features/workspace/editor/preview";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCodeHighlight } from "./use-code-highlight";
import type { HighlightToken } from "./highlight.worker";

export interface AICodeBlockProps {
  code: string;
  language?: string;
  /* ---- 8.5 structured metadata (typed payload; absent = plain block) ---- */
  /** Model-provided filename (may be unknown — never guessed). */
  filename?: string | null;
  /** 1-based range of the REFERENCED REAL FILE this snippet relates to. */
  lineStart?: number | null;
  lineEnd?: number | null;
  /** generated = model-authored; modified = presented as a change to a real file. */
  status?: "generated" | "modified" | null;
  /** Whether the filename resolved in the real workspace (verifier truth). */
  fileStatus?: "verified" | "unknown" | null;
  /** Lines of the referenced real file to highlight (1-based). */
  highlightLines?: number[];
}

const COPY_RESET_MS = 1_600;
/** Above this line count the body gets a max-height + expand/collapse control. */
const COLLAPSE_LINE_THRESHOLD = 16;

const EXTENSION_BY_LANGUAGE: Record<string, string> = {
  bash: "sh",
  c: "c",
  cpp: "cpp",
  cs: "cs",
  css: "css",
  go: "go",
  graphql: "graphql",
  html: "html",
  java: "java",
  javascript: "js",
  json: "json",
  jsx: "jsx",
  kotlin: "kt",
  md: "md",
  php: "php",
  python: "py",
  rb: "rb",
  ruby: "rb",
  rust: "rs",
  scss: "scss",
  sh: "sh",
  shell: "sh",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "ts",
  tsx: "tsx",
  typescript: "ts",
  yaml: "yml",
  zsh: "sh",
};

function extensionForLanguage(language: string | undefined): string {
  if (!language) return "txt";
  return EXTENSION_BY_LANGUAGE[language.toLowerCase()] ?? "txt";
}

/** `// file: src/x.ts` | `# file: src/x.py` on the FIRST line only. */
function extractFileReference(code: string): string | null {
  const firstLine = code.slice(0, code.indexOf("\n") === -1 ? undefined : code.indexOf("\n"));
  const match =
    /^\/\/\s*file:\s*(\S+)/.exec(firstLine) ??
    /^#\s*file:\s*(\S+)/.exec(firstLine);
  return match?.[1] ?? null;
}

function HeaderIconButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={onClick}
          className={cn(
            "size-6 rounded-[4px] text-[#a89f93] hover:bg-white/5 hover:text-[#d6d1c8] focus-visible:ring-ring/60",
            active && "bg-white/10 text-[#d6d1c8]",
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/* Contextual footer actions                                           */
/* ------------------------------------------------------------------ */

function FooterAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  disabledReason,
}: {
  label: string;
  icon: typeof Eye;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-disabled="true"
            className="inline-flex h-6 cursor-not-allowed items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground/50 select-none"
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-56 text-[10.5px]">{disabledReason}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground",
        "transition-colors hover:bg-white/5 hover:text-[#d6d1c8]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Highlighted body (worker tokens → React spans; never innerHTML)      */
/* ------------------------------------------------------------------ */

const TOKEN_CLASS: Record<HighlightToken["t"], string> = {
  c: "text-[#7d8590] italic",
  s: "text-[#a5d6a7]",
  n: "text-[#f2cc60]",
  k: "text-[#d2a8ff]",
  f: "text-[#8ab4f8]",
  p: "text-[#c9c3ba]",
  x: "",
};

function HighlightedCode({
  code,
  language,
  lineCount,
  startLine,
  highlightSet,
  wrap,
}: {
  code: string;
  language: string | undefined;
  lineCount: number;
  startLine: number;
  highlightSet: Set<number> | null;
  wrap: boolean;
}) {
  const { lines: tokens } = useCodeHighlight(code, language, lineCount);
  const codeLines = useMemo(() => code.split("\n"), [code]);

  return (
    <div className={cn("p-2.5 font-mono text-[11.5px] leading-[1.6] text-[#d6d1c8]")}>
      {codeLines.map((line, i) => {
        const number = startLine + i;
        const highlighted = highlightSet?.has(number) ?? false;
        const runs = tokens?.[i] ?? null;
        return (
          <div
            key={i}
            className={cn(
              "flex min-w-fit",
              highlighted && "bg-primary/15 border-l-2 border-primary",
            )}
          >
            <span className="mr-3 w-9 shrink-0 select-none text-right text-[10px] text-[#6b655c]">
              {number}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1",
                wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
                highlighted && "text-foreground",
              )}
            >
              {runs
                ? runs.map((run, j) => (
                    <span key={j} className={TOKEN_CLASS[run.t]}>
                      {run.v}
                    </span>
                  ))
                : line || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The block                                                           */
/* ------------------------------------------------------------------ */

export function AICodeBlock({
  code,
  language,
  filename = null,
  lineStart = null,
  lineEnd = null,
  status = null,
  fileStatus = null,
  highlightLines,
}: AICodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [diffState, setDiffState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    original?: string;
    error?: string;
  }>({ status: "idle" });
  const copyTimerRef = useRef<number | null>(null);
  const openGeneratedTab = useWorkspaceStore((s) => s.openGeneratedTab);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const lineCount = useMemo(() => code.split("\n").length, [code]);
  const inlineFileReference = useMemo(() => extractFileReference(code), [code]);
  const fileReference = filename ?? inlineFileReference;
  const expandable = lineCount > COLLAPSE_LINE_THRESHOLD;
  const previewable = previewKindForLanguage(language) !== "none";
  const showLineNumbers =
    Boolean(highlightLines && highlightLines.length > 0) ||
    typeof lineStart === "number" ||
    typeof status === "string";
  const highlightSet = useMemo(
    () => (highlightLines && highlightLines.length > 0 ? new Set(highlightLines) : null),
    [highlightLines],
  );

  const copy = useCallback(() => {
    try {
      void navigator.clipboard
        .writeText(code)
        .then(() => {
          setCopied(true);
          if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
          copyTimerRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS);
        })
        .catch(() => {
          // clipboard permission denied — leave state honest (not copied)
        });
    } catch {
      // clipboard API unavailable in this context
    }
  }, [code]);

  const download = useCallback(() => {
    try {
      const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename
        ? filename.split("/").pop() ?? `snippet.${extensionForLanguage(language)}`
        : `snippet.${extensionForLanguage(language)}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      // download unavailable — the snippet stays visible either way
    }
  }, [code, language, filename]);

  const openInEditor = useCallback(() => {
    if (fileReference) {
      void editorNavigation.open({
        filePath: fileReference,
        sourceContext: "chat",
        navigationReason: "AI code block file reference",
      });
      return;
    }
    // No repository file association — an honest GENERATED scratch tab.
    const name = `snippet.${extensionForLanguage(language)}`;
    openGeneratedTab(name, code, language);
  }, [fileReference, openGeneratedTab, code, language]);

  const loadDiffOriginal = useCallback(async () => {
    if (!fileReference) return;
    setDiffState({ status: "loading" });
    try {
      const res = await fetch(
        `/api/repository/file?path=${encodeURIComponent(fileReference)}`,
        { cache: "no-store" },
      );
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; file?: { content?: string }; error?: string }
        | null;
      if (res.ok && data?.ok && typeof data.file?.content === "string") {
        setDiffState({ status: "ready", original: data.file.content });
      } else {
        setDiffState({
          status: "error",
          error:
            data?.error ??
            `The referenced file could not be loaded (HTTP ${res.status}).`,
        });
      }
    } catch {
      setDiffState({ status: "error", error: "The file service is unreachable right now." });
    }
  }, [fileReference]);

  const openDiff = useCallback(() => {
    setDiffState({ status: "idle" });
    setDiffOpen(true);
    void loadDiffOriginal();
  }, [loadDiffOriginal]);

  const diffChange: FileChange | null = useMemo(() => {
    if (!fileReference || diffState.status !== "ready") return null;
    return {
      path: fileReference,
      operation: "modify",
      original: diffState.original,
      proposed: code,
      language,
    };
  }, [fileReference, diffState, code, language]);

  const previewDoc = useMemo(
    () => (previewOpen ? buildPreviewDocument(code, language) : null),
    [previewOpen, code, language],
  );

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border-subtle bg-[#131110]" data-testid="ai-code-block">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-b border-white/5 px-2.5 py-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate font-mono text-[10.5px] text-[#d6d1c8]">
            {filename ?? language ?? "code"}
          </span>
          {filename && language ? (
            <span className="font-mono text-[10px] text-[#a89f93]/70">{language}</span>
          ) : null}
          {typeof lineStart === "number" ? (
            <span
              className="font-mono text-[10px] text-[#a89f93]/70"
              title={`Line range of the referenced file`}
            >
              L{lineStart}
              {typeof lineEnd === "number" && lineEnd !== lineStart ? `–${lineEnd}` : ""}
            </span>
          ) : null}
          {status === "modified" ? (
            <span
              className="rounded-full border border-warning/40 px-1.5 py-px text-[9px] uppercase tracking-wide text-warning"
              title="This block proposes a change to the referenced file — nothing is applied without the approval flow."
            >
              Modified
            </span>
          ) : status === "generated" ? (
            <span
              className="rounded-full border border-border-subtle px-1.5 py-px text-[9px] uppercase tracking-wide text-muted-foreground"
              title="Model-authored snippet — not present in the repository."
            >
              Generated
            </span>
          ) : null}
          {fileStatus === "unknown" && filename ? (
            <span
              className="rounded-full border border-destructive/40 px-1.5 py-px text-[9px] uppercase tracking-wide text-destructive"
              title="This filename could not be verified in the workspace — treat it as a proposal, not a real file."
            >
              Unknown file
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-0.5">
          <HeaderIconButton label={copied ? "Copied" : "Copy code"} onClick={copy}>
            {copied ? (
              <Check aria-hidden="true" className="size-3.5 text-success" />
            ) : (
              <Copy aria-hidden="true" className="size-3.5" />
            )}
          </HeaderIconButton>
          <HeaderIconButton
            label={wrap ? "No word-wrap" : "Word-wrap"}
            active={wrap}
            onClick={() => setWrap((v) => !v)}
          >
            <WrapText aria-hidden="true" className="size-3.5" />
          </HeaderIconButton>
          {expandable && (
            <HeaderIconButton
              label={expanded ? "Collapse code" : "Expand code"}
              onClick={() => setExpanded((v) => !v)}
            >
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-3.5 transition-transform duration-200 motion-reduce:transition-none",
                  expanded && "rotate-180",
                )}
              />
            </HeaderIconButton>
          )}
          <HeaderIconButton label="Download snippet" onClick={download}>
            <Download aria-hidden="true" className="size-3.5" />
          </HeaderIconButton>
        </div>
      </div>

      {/* Both collapsed and expanded states scroll internally — never the page. */}
      <div
        className={cn(
          "overflow-y-auto overflow-x-auto",
          expandable && (expanded ? "max-h-96" : "max-h-64"),
        )}
      >
        {showLineNumbers ? (
          <HighlightedCode
            code={code}
            language={language}
            lineCount={lineCount}
            startLine={lineStart ?? 1}
            highlightSet={highlightSet}
            wrap={wrap}
          />
        ) : (
          <pre
            className={cn(
              "p-2.5 font-mono text-[11.5px] leading-[1.6] text-[#d6d1c8]",
              wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
            )}
          >
            <code>{code}</code>
          </pre>
        )}
      </div>

      {/* Contextual footer — only RELEVANT actions render (spec §7). */}
      <div className="flex flex-wrap items-center gap-1 border-t border-white/5 px-2 py-1">
          <FooterAction
            label={fileReference ? "Open in Editor" : "Open as generated"}
            icon={fileReference ? FilePlus2 : PlaySquare}
            onClick={openInEditor}
          />
          {previewable ? (
            <FooterAction
              label="Preview"
              icon={Eye}
              onClick={() => {
                setPreviewKey((k) => k + 1);
                setPreviewOpen(true);
              }}
            />
          ) : null}
          {fileReference ? (
            <FooterAction label="Review Diff" icon={FileDiff} onClick={openDiff} />
          ) : null}
          {fileReference ? (
            <FooterAction
              label="Apply"
              icon={Check}
              disabled
              disabledReason="Applying requires the visible-diff approval flow — nothing is written without explicit human approval."
            />
          ) : null}
      </div>

      {/* Sandboxed preview (spec §9) — never executes in the production window. */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-2 bg-surface sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-[13px]">Sandboxed preview</DialogTitle>
            <DialogDescription className="text-[11px]">
              Rendered inside an isolated sandbox (allow-scripts only). {previewDoc?.note}
            </DialogDescription>
          </DialogHeader>
          {previewDoc ? (
            <iframe
              key={previewKey}
              title="Sandboxed code preview"
              sandbox="allow-scripts"
              srcDoc={previewDoc.html}
              className="h-[60vh] min-h-0 w-full rounded-md border border-border-subtle bg-white"
            />
          ) : null}
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => setPreviewKey((k) => k + 1)}
            >
              Reload
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Real diff review (spec §7/§10) */}
      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-2 bg-surface sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-[13px]">Review diff</DialogTitle>
            <DialogDescription className="text-[11px]">
              Loaded file content vs the AI snippet — a real diff, nothing applied.
            </DialogDescription>
          </DialogHeader>
          {diffState.status === "loading" || diffState.status === "idle" ? (
            <div className="flex h-40 items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <div className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              Loading baseline…
            </div>
          ) : diffState.status === "error" ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[11px] text-destructive">
              {diffState.error}
            </div>
          ) : diffChange ? (
            <DiffViewer change={diffChange} height={420} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
