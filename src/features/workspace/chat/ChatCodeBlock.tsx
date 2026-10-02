"use client";

/**
 * CodeMind X V2 — chat code block.
 *
 * Honest lightweight preview for fenced code in assistant answers: no syntax
 * highlighting engine is claimed, just a contained mono block with real
 * copy/download/expand affordances. All scrolling happens INSIDE the block —
 * it can never push the page or panel wider/taller.
 *
 * The "Open in editor" action only appears when the snippet's first line
 * explicitly carries a `// file: <path>` / `# file: <path>` reference pointing
 * at a real workspace file; otherwise there is no such button.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown, Copy, Download, FileCode2 } from "lucide-react";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ChatCodeBlockProps {
  code: string;
  language?: string;
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

/** Minimal icon button with tooltip + aria-label (focus-visible ring on Button). */
function HeaderIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
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
          className="size-6 rounded-[4px] text-[#a89f93] hover:bg-white/5 hover:text-[#d6d1c8] focus-visible:ring-ring/60"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ChatCodeBlock({ code, language }: ChatCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const lineCount = useMemo(() => code.split("\n").length, [code]);
  const fileReference = useMemo(() => extractFileReference(code), [code]);
  const expandable = lineCount > COLLAPSE_LINE_THRESHOLD;

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
      anchor.download = `snippet.${extensionForLanguage(language)}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      // download unavailable — the snippet stays visible either way
    }
  }, [code, language]);

  const openInEditor = useCallback(() => {
    if (!fileReference) return;
    void editorNavigation.open({
      filePath: fileReference,
      sourceContext: "chat",
      navigationReason: "code block file reference",
    });
  }, [fileReference]);

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border-subtle bg-[#131110]">
      <div className="flex h-8 items-center justify-between border-b border-white/5 px-2.5">
        <span className="font-mono text-[10.5px] text-[#a89f93]">
          {language ?? "code"}
        </span>
        <div className="flex items-center gap-0.5">
          {fileReference && (
            <HeaderIconButton label="Open in editor" onClick={openInEditor}>
              <FileCode2 className="size-3.5" />
            </HeaderIconButton>
          )}
          <HeaderIconButton label={copied ? "Copied" : "Copy code"} onClick={copy}>
            {copied ? (
              <Check aria-hidden="true" className="size-3.5 text-success" />
            ) : (
              <Copy aria-hidden="true" className="size-3.5" />
            )}
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
        <pre className="whitespace-pre p-2.5 font-mono text-[11.5px] leading-[1.6] text-[#d6d1c8]">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
