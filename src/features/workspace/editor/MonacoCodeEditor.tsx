"use client";

/**
 * CodeMind X V2 — Monaco code editor (Phase 6 §1/§2/§5).
 *
 * The REAL editor surface: syntax highlighting, language detection, line
 * numbers, folding, selection, minimap (policy-based), find/replace with
 * regex, go-to-line and quick outline (text-scan symbols). Content is
 * editable in memory; buffers that differ from the loaded baseline show an
 * honest dirty indicator — file writes arrive in a later phase, and no save
 * is faked.
 *
 * Selected-code AI actions (§5): a floating toolbar over non-empty
 * selections routes the EXACT selected text + location into the AI composer
 * via the workspace store queue.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditorNS } from "monaco-editor";
import {
  FlaskConical,
  Gauge,
  MessageSquarePlus,
  ScrollText,
  ShieldCheck,
  Sparkles,
  SquareCode,
  Wand2,
  Wrench,
} from "lucide-react";

import type { EditorRange } from "@/features/workspace/repository/CodeEditorViewport";
import type { SelectionAIAction } from "@/features/workspace/types";
import { SELECTION_ACTION_PROMPTS } from "@/features/workspace/types";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { getEditorBaseline, registerEditorBaseline } from "./baselines";
import type { BlameRange, DiffHunk } from "@/features/workspace/diff-contracts";
import {
  defineCodeMindThemes,
  EDITOR_COMMAND_EVENT,
  ensureMonacoLoaderConfigured,
  monacoLanguageForPath,
  setActiveMonacoInstance,
  type EditorCommandEventDetail,
} from "./monaco-setup";
import {
  registerCodeIntelligenceProviders,
  type TextSymbol,
} from "./code-intelligence";

ensureMonacoLoaderConfigured();

export interface MonacoCodeEditorProps {
  path: string;
  content: string;
  language: string;
  generated?: boolean;
  /** 1-based target line (navigation). */
  line?: number;
  /** Target range (navigation). */
  range?: EditorRange;
  /** Pane identity for focus routing ("a" primary / "b" split). */
  paneId?: "a" | "b";
  /** Large-file mode disables the minimap + animations (perf §11). */
  largeFile?: boolean;
  /** Real changed-line hunks (git diff, Phase 6 §4) → gutter decorations. */
  changedHunks?: DiffHunk[] | null;
  /** Real blame ranges (git blame, Phase 6 §4) → inline author tags. */
  blameRanges?: BlameRange[] | null;
  className?: string;
}
/* ------------------------------------------------------------------ */
/* Dirty tracking                                                      */
/* ------------------------------------------------------------------ */

/** Debounced store write so typing does not thrash the store per keystroke. */
function useDirtySync(path: string, content: string) {
  useEffect(() => {
    // Fresh baseline for newly loaded content.
    registerEditorBaseline(path, content);
    useWorkspaceStore.getState().setTabDirty(path, false);
  }, [path, content]);
}

/* ------------------------------------------------------------------ */
/* Selection AI actions toolbar (Phase 6 §5)                           */
/* ------------------------------------------------------------------ */

interface ToolbarState {
  startLine: number;
  endLine: number;
  code: string;
  top: number;
  left: number;
}

const ACTION_ORDER: SelectionAIAction[] = [
  "explain",
  "review",
  "fix",
  "refactor",
  "optimize",
  "tests",
  "docs",
  "security",
  "ask",
];

const ACTION_ICONS: Record<SelectionAIAction, typeof Sparkles> = {
  explain: Sparkles,
  review: ScrollText,
  fix: Wrench,
  refactor: Wand2,
  optimize: Gauge,
  tests: FlaskConical,
  docs: SquareCode,
  security: ShieldCheck,
  ask: MessageSquarePlus,
};

function SelectionToolbar({
  state,
  onAction,
}: {
  state: ToolbarState;
  onAction: (action: SelectionAIAction) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="AI actions for the selected code"
      data-testid="selection-ai-toolbar"
      style={{ top: state.top, left: state.left }}
      className={cn(
        "absolute z-20 flex items-center gap-0.5 rounded-md border border-border-subtle",
        "bg-popover/95 p-0.5 shadow-md backdrop-blur",
      )}
    >
      {ACTION_ORDER.map((action) => {
        const meta = SELECTION_ACTION_PROMPTS[action];
        const Icon = ACTION_ICONS[action];
        return (
          <Tooltip key={action}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={meta.label}
                onClick={() => onAction(action)}
                className="size-6 rounded-[4px] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring/60"
              >
                <Icon aria-hidden="true" className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[10.5px]">
              {meta.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The editor                                                          */
/* ------------------------------------------------------------------ */

export function MonacoCodeEditor({
  path,
  content,
  language,
  generated = false,
  line,
  range,
  paneId = "a",
  largeFile = false,
  changedHunks,
  blameRanges,
  className,
}: MonacoCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const gitDecorationsRef = useRef<string[]>([]);
  const baselineRef = useRef<string>(content);

  const [ready, setReady] = useState(false);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);

  useDirtySync(path, content);

  /* Focus routing: the app dispatches commands to the active pane. */
  const focusPane = useCallback(() => {
    const store = useWorkspaceStore.getState();
    if (store.splitEditor && store.activeEditorPane !== paneId) {
      store.setActiveEditorPane(paneId);
    }
  }, [paneId]);

  /* ---------------- navigation (line/range reveal + decorations) ------ */
  const applyNavigationTarget = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;

    const targetLine =
      line ?? (range && Number.isFinite(range.startLine) ? Math.floor(range.startLine) : undefined);
    if (!targetLine || targetLine < 1) {
      // Clear stale decorations when navigating without a target.
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      return;
    }
    const safeLine = Math.min(targetLine, model.getLineCount());
    const start = Math.max(1, Math.floor(range?.startLine ?? safeLine));
    const end = Math.min(
      model.getLineCount(),
      Math.max(start, Math.floor(range?.endLine ?? safeLine)),
    );

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
      {
        range: new monaco.Range(start, 1, end, 1),
        options: {
          isWholeLine: true,
          className: start === end ? "cmx-target-line" : "cmx-target-range",
          linesDecorationsClassName:
            start === end ? "cmx-target-line-gutter" : "cmx-target-range-gutter",
          overviewRuler: {
            color: "#d6a96a",
            position: monaco.editor.OverviewRulerLane.Center,
          },
        },
      },
    ]);

    editor.revealLineInCenter(safeLine);
    editor.setPosition({ lineNumber: safeLine, column: 1 });
    editor.focus();
  }, [line, range]);

  useEffect(() => {
    if (!ready) return;
    applyNavigationTarget();
  }, [ready, applyNavigationTarget, path]);

  /* ---------------- git decorations (changed lines + blame) ------------ */
  useEffect(() => {
    if (!ready) return;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;

    const decorations: MonacoEditorNS.IModelDeltaDecoration[] = [];

    // Changed lines from REAL git diff hunks. Only ADDED lines exist in the
    // worktree model, so removed lines are reported in the hunk hover —
    // never positioned on the wrong line.
    for (const hunk of changedHunks ?? []) {
      const addedStart = hunk.newStart;
      const addedEnd = hunk.newStart + Math.max(0, hunk.newLines) - 1;
      if (hunk.newLines > 0 && addedStart >= 1) {
        decorations.push({
          range: new monaco.Range(
            addedStart,
            1,
            Math.min(addedEnd, model.getLineCount()),
            1,
          ),
          options: {
            isWholeLine: true,
            linesDecorationsClassName: "cmx-changed-line-gutter",
            hoverMessage: {
              value: hunk.oldLines > 0
                ? `Hunk: +${hunk.newLines} / -${hunk.oldLines} (old start line ${hunk.oldStart})`
                : `Added: +${hunk.newLines} lines`,
            },
          },
        });
      }
    }

    // Blame tags from REAL git blame ranges.
    for (const range of (blameRanges ?? []).slice(0, 2_000)) {
      if (!range.date) continue;
      const dateShort = range.date.slice(0, 10);
      decorations.push({
        range: new monaco.Range(
          range.startLine,
          1,
          Math.min(range.endLine, model.getLineCount()),
          1,
        ),
        options: {
          isWholeLine: true,
          after: {
            content: `  ${range.author} · ${dateShort}`,
            inlineClassName: "cmx-blame-tag",
          },
          hoverMessage: { value: `${range.sha.slice(0, 8)} — ${range.author}, ${range.date}` },
        },
      });
    }

    gitDecorationsRef.current = editor.deltaDecorations(gitDecorationsRef.current, decorations);
  }, [ready, changedHunks, blameRanges, path]);

  /* ---------------- app-level editor commands (Ctrl+G etc.) ------------ */
  useEffect(() => {
    if (!ready) return;
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<EditorCommandEventDetail>).detail;
      if (!detail) return;
      // Only the ACTIVE pane executes the command.
      const store = useWorkspaceStore.getState();
      if (store.splitEditor && store.activeEditorPane !== paneId) return;
      const editor = editorRef.current;
      if (!editor) return;
      if (detail.command === "goto-line") {
        editor.focus();
        void editor.getAction("editor.action.gotoLine")?.run();
      } else if (detail.command === "quick-outline") {
        editor.focus();
        void editor.getAction("editor.action.quickOutline")?.run();
      } else if (detail.command === "find") {
        editor.focus();
        void editor.getAction("actions.find")?.run();
      } else if (detail.command === "replace") {
        editor.focus();
        void editor.getAction("editor.action.startFindReplaceAction")?.run();
      }
    };
    window.addEventListener(EDITOR_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(EDITOR_COMMAND_EVENT, onCommand);
  }, [ready, paneId]);

  /* ---------------- selection → AI context toolbar --------------------- */
  const repositionToolbar = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model || selection.isEmpty()) {
      setToolbar(null);
      return;
    }
    const code = model.getValueInRange(selection);
    if (!code.trim()) {
      setToolbar(null);
      return;
    }
    const domNode = editor.getDomNode();
    const container = containerRef.current;
    if (!domNode || !container) return;
    const position = editor.getScrolledVisiblePosition({
      lineNumber: selection.startLineNumber,
      column: selection.startColumn,
    });
    if (!position) {
      setToolbar(null);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const left = Math.max(4, Math.min(position.left, containerRect.width - 260));
    const top = Math.max(4, Math.min(position.top + 28, containerRect.height - 40));
    setToolbar({
      startLine: selection.startLineNumber,
      endLine: selection.endLineNumber,
      code,
      top,
      left,
    });
  }, []);

  const handleAction = useCallback(
    (action: SelectionAIAction) => {
      const store = useWorkspaceStore.getState();
      const state = toolbar;
      setToolbar(null);
      if (!state) return;
      store.queueChatSelection({
        path,
        startLine: state.startLine,
        endLine: state.endLine,
        language: language || null,
        code: state.code,
        action,
      });
    },
    [toolbar, path, language],
  );

  /* ---------------- mount handlers ------------------------------------- */
  const handleMount = useCallback(
    (editor: MonacoEditorNS.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      defineCodeMindThemes(monaco);
      registerCodeIntelligenceProviders(monaco);
      monaco.editor.setTheme("codemind-dark");
      setActiveMonacoInstance(monaco);

      editor.onDidChangeCursorSelection(() => repositionToolbar());
      editor.onDidScrollChange(() => {
        if (toolbar) repositionToolbar();
      });
      // In-memory dirty flag: buffer differs from the loaded baseline.
      baselineRef.current = getEditorBaseline(path) ?? content;
      editor.onDidChangeModelContent(() => {
        const model = editor.getModel();
        if (!model) return;
        const dirty = model.getValue() !== baselineRef.current;
        useWorkspaceStore.getState().setTabDirty(path, dirty);
      });

      // Explicit in-editor keybindings (Monaco also has native ones; these
      // make the mapping deterministic inside the editor).
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
        void editor.getAction("editor.action.gotoLine")?.run();
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO, () => {
        void editor.getAction("editor.action.quickOutline")?.run();
      });

      setReady(true);
    },
    [repositionToolbar, path, content, toolbar],
  );

  const options = useMemo<MonacoEditorNS.IStandaloneEditorConstructionOptions>(
    () => ({
      readOnly: false,
      minimap: { enabled: !largeFile, renderCharacters: false },
      fontSize: 12.5,
      lineHeight: 1.65,
      fontFamily:
        "var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace",
      lineNumbers: "on",
      folding: true,
      renderLineHighlight: "all",
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      automaticLayout: true,
      wordWrap: "off",
      occurrencesHighlight: "singleFile",
      quickSuggestions: false,
      suggestOnTriggerCharacters: true,
      bracketPairColorization: { enabled: true },
      padding: { top: 8, bottom: 24 },
      cursorBlinking: largeFile ? "solid" : "smooth",
      renderWhitespace: "selection",
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      overviewRulerBorder: false,
      guides: { indentation: true },
      stickyScroll: { enabled: false },
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: true },
    }),
    [largeFile],
  );

  return (
    <div
      ref={containerRef}
      className={cn("relative min-h-0 flex-1 overflow-hidden", className)}
      data-editor-pane={paneId}
      onFocusCapture={focusPane}
      onMouseDown={focusPane}
    >
      <Editor
        height="100%"
        theme="codemind-dark"
        language={language}
        path={path}
        value={content}
        options={options}
        onMount={handleMount}
        loading={
          <div
            aria-busy="true"
            aria-label="Loading editor"
            className="flex h-full items-center justify-center bg-surface"
          >
            <div className="flex flex-col items-center gap-2">
              <div className="size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              <p className="text-[11px] text-muted-foreground">Loading editor…</p>
            </div>
          </div>
        }
      />
      {toolbar ? <SelectionToolbar state={toolbar} onAction={handleAction} /> : null}
    </div>
  );
}

/** Exposed for the intelligence panel: symbol outline of arbitrary content. */
export type { TextSymbol };
