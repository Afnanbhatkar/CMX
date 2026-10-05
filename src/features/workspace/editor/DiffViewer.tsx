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
import { useEffect, useRef } from "react";
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

export function DiffViewer({ change, height = 380, className }: DiffViewerProps) {
  const language = languageFor(change);
  const hasBoth = change.original !== undefined && change.proposed !== undefined;

  /* Model lifecycle ownership (Monaco ≥0.5x contract).
   *
   * @monaco-editor/react v4.7 disposes the diff's original/modified models
   * BEFORE resetting the DiffEditorWidget on unmount. Disposing a text model
   * while the widget still holds it trips Monaco's guard — "TextModel got
   * disposed before DiffEditorWidget model got reset" — which surfaces as a
   * runtime error overlay (e.g. closing the Review-diff dialog, toggling the
   * git diff view). So this component takes ownership of the models:
   * - `keepCurrentOriginalModel` / `keepCurrentModifiedModel` stop the
   *   wrapper from disposing them;
   * - our cleanup runs AFTER the wrapper's own unmount work (React unwinds
   *   child effects first) and disposes in the safe order: reset the widget
   *   model, then dispose the models.
   */
  const diffEditorRef = useRef<MonacoEditorNS.IStandaloneDiffEditor | null>(null);
  const diffModelsRef = useRef<{
    original: MonacoEditorNS.ITextModel | null;
    modified: MonacoEditorNS.ITextModel | null;
  }>({ original: null, modified: null });

  useEffect(() => {
    return () => {
      try {
        diffEditorRef.current?.setModel(null);
      } catch {
        // The widget may already be disposed — its models are then detached.
      }
      for (const model of [diffModelsRef.current.original, diffModelsRef.current.modified]) {
        try {
          if (model && !model.isDisposed()) model.dispose();
        } catch {
          // Already disposed elsewhere — nothing left to free.
        }
      }
      diffEditorRef.current = null;
      diffModelsRef.current = { original: null, modified: null };
    };
  }, []);

  const handleMount = (editor: MonacoEditorNS.IStandaloneDiffEditor, monaco: Monaco): void => {
    diffEditorRef.current = editor;
    const model = editor.getModel();
    diffModelsRef.current = {
      original: model?.original ?? null,
      modified: model?.modified ?? null,
    };
    defineCodeMindThemes(monaco);
    monaco.editor.setTheme("codemind-dark");
  };

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
          keepCurrentOriginalModel
          keepCurrentModifiedModel
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
