"use client";

/**
 * CodeMind X V2 — shared DiffViewer (Phase 6 §10).
 *
 * THE one diff component consumed by AI code blocks (Review Diff) and by
 * future AI coding phases (approvals, patches). Renders a REAL Monaco
 * DiffEditor from FileChange data; when a side is missing it shows an honest
 * note instead of an empty pane.
 */

import { DiffEditor, type Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditorNS } from "monaco-editor";
import { FileDiff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { FileChange } from "@/features/workspace/diff-contracts";
import { cn } from "@/lib/utils";

import { defineCodeMindThemes, ensureMonacoLoaderConfigured } from "./monaco-setup";
import { monacoLanguageForLabel, monacoLanguageForPath } from "./monaco-setup";

ensureMonacoLoaderConfigured();

export interface DiffViewerProps {
  change: FileChange;
  /** Height of the diff area — px number or CSS string (e.g. "100%"). */
  height?: number | string;
  className?: string;
}

const OPERATION_LABEL: Record<FileChange["operation"], string> = {
  create: "created",
  modify: "modified",
  delete: "deleted",
  rename: "renamed",
};

function languageFor(change: FileChange): string {
  return monacoLanguageForLabel(change.language ?? null) || monacoLanguageForPath(change.path);
}

function handleMount(_editor: unknown, monaco: Monaco): void {
  defineCodeMindThemes(monaco);
  monaco.editor.setTheme("codemind-dark");
}

export function DiffViewer({ change, height = 380, className }: DiffViewerProps) {
  const language = languageFor(change);
  const hasBoth = change.original !== undefined && change.proposed !== undefined;

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-md border border-border-subtle",
        height === "100%" && "flex h-full min-h-0 flex-col",
        className,
      )}
    >
      <div className="flex h-8 items-center gap-2 border-b border-border-subtle bg-surface px-2.5 text-[11px] text-muted-foreground">
        <FileDiff aria-hidden="true" className="size-3.5" />
        <span className="min-w-0 truncate font-mono text-foreground/80">{change.path}</span>
        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
          {OPERATION_LABEL[change.operation]}
        </Badge>
        {!hasBoth ? (
          <span className="ml-auto shrink-0">
            {change.operation === "delete"
              ? "File deleted — original shown"
              : change.original === undefined
                ? "No baseline — proposed content only"
                : "Original only"}
          </span>
        ) : null}
      </div>
      {change.original === undefined && change.proposed === undefined ? (
        <div className="flex flex-col items-center justify-center gap-1 p-6 text-center">
          <p className="text-[12px] text-foreground/80">Nothing to diff.</p>
          <p className="text-[11px] text-muted-foreground">
            This change carries no original or proposed content.
          </p>
        </div>
      ) : (
        <DiffEditor
          height={height}
          theme="codemind-dark"
          language={language}
          original={change.original ?? ""}
          modified={change.proposed ?? ""}
          onMount={handleMount}
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            fontSize: 12,
            lineHeight: 1.6,
            renderOverviewRuler: false,
            diffWordWrap: "off",
            hideUnchangedRegions: { enabled: true, contextLineCount: 3 },
          } satisfies Partial<MonacoEditorNS.IDiffEditorOptions> as MonacoEditorNS.IDiffEditorOptions}
          loading={
            <div className="flex h-full items-center justify-center bg-surface">
              <div className="size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            </div>
          }
        />
      )}
    </div>
  );
}
