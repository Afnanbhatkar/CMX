"use client";

/**
 * CodeMind X V2 — Monaco setup (Phase 6 §1).
 *
 * Central self-hosted configuration for the bundled Monaco Editor:
 * - loader points at the copy of `monaco-editor/min/vs` under /public/monaco/vs
 *   (no CDN dependency, works offline in the sandbox preview);
 * - the "codemind" theme matches the app's warm dark design tokens;
 * - a single language-id map shared by the editor, code blocks and
 *   intelligence surfaces.
 *
 * Honesty note (Phase 6 §3): language INTELLIGENCE providers live in
 * code-intelligence.ts; this module only wires the editor runtime.
 */

import { loader, type Monaco } from "@monaco-editor/react";

export type MonacoThemeId = "codemind-dark" | "codemind-light";

/** Client-side path → Monaco language id (mirrors the server's map). */
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
  ".sh": "shell",
  ".bash": "shell",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "ini",
  ".ini": "ini",
  ".svg": "xml",
  ".xml": "xml",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".sql": "sql",
  ".graphql": "graphql",
  ".java": "java",
  ".kt": "kotlin",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".swift": "swift",
  ".txt": "plaintext",
};

export function monacoLanguageForPath(path: string): string {
  const idx = path.lastIndexOf(".");
  const ext = idx === -1 ? "" : path.slice(idx).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? "plaintext";
}

/** Maps a human language label ("typescript", "jsx"…) to a Monaco id. */
export function monacoLanguageForLabel(label: string | null | undefined): string {
  if (!label) return "plaintext";
  const normalized = label.toLowerCase().trim();
  const direct: Record<string, string> = {
    typescript: "typescript",
    ts: "typescript",
    tsx: "typescript",
    javascript: "javascript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    css: "css",
    scss: "scss",
    html: "html",
    xml: "xml",
    markdown: "markdown",
    md: "markdown",
    python: "python",
    py: "python",
    shell: "shell",
    bash: "shell",
    sh: "shell",
    yaml: "yaml",
    sql: "sql",
    graphql: "graphql",
    go: "go",
    rust: "rust",
    ruby: "ruby",
    java: "java",
    plaintext: "plaintext",
    text: "plaintext",
  };
  return direct[normalized] ?? monacoLanguageForPath(`x.${normalized}`);
}

let configured = false;

/** Point the AMD loader at the self-hosted copy (idempotent). */
export function ensureMonacoLoaderConfigured(): void {
  if (configured) return;
  configured = true;
  loader.config({
    paths: { vs: "/monaco/vs" },
  });
}

/** Register the CodeMind themes once Monaco is available. */
export function defineCodeMindThemes(monaco: Monaco): void {
  const define = (id: MonacoThemeId, dark: boolean) => {
    monaco.editor.defineTheme(id, {
      base: dark ? "vs-dark" : "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "8a8378", fontStyle: "italic" },
        { token: "keyword", foreground: "c9a26d" },
        { token: "keyword.control", foreground: "c9a26d" },
        { token: "string", foreground: "9db58a" },
        { token: "number", foreground: "d6a96a" },
        { token: "regexp", foreground: "b58f7a" },
        { token: "type", foreground: "8fb5a3" },
        { token: "type.identifier", foreground: "8fb5a3" },
        { token: "identifier", foreground: "e8e4dd" },
        { token: "function", foreground: "d8b47a" },
        { token: "delimiter", foreground: "a89f93" },
        { token: "tag", foreground: "c9a26d" },
        { token: "attribute.name", foreground: "8fb5a3" },
        { token: "attribute.value", foreground: "9db58a" },
        { token: "variable", foreground: "e8e4dd" },
        { token: "variable.predefined", foreground: "b58f7a" },
      ],
      colors: dark
        ? {
            "editor.background": "#161413",
            "editor.foreground": "#e8e4dd",
            "editorLineNumber.foreground": "#6b6459",
            "editorLineNumber.activeForeground": "#b3aa9c",
            "editor.selectionBackground": "#3a332a",
            "editor.inactiveSelectionBackground": "#2b2620",
            "editor.lineHighlightBackground": "#211e1c",
            "editorCursor.foreground": "#d6a96a",
            "editorIndentGuide.background1": "#2a2724",
            "editorIndentGuide.activeBackground1": "#4a443c",
            "editorWidget.background": "#1d1a18",
            "editorWidget.border": "#332f2b",
            "editorSuggestWidget.background": "#1d1a18",
            "editorSuggestWidget.border": "#332f2b",
            "editorSuggestWidget.selectedBackground": "#2b2620",
            "editorHoverWidget.background": "#1d1a18",
            "editorHoverWidget.border": "#332f2b",
            "input.background": "#211e1c",
            "input.border": "#332f2b",
            "scrollbarSlider.background": "#3a352f80",
            "scrollbarSlider.hoverBackground": "#4a443caa",
            "scrollbarSlider.activeBackground": "#5a5348cc",
            "minimap.background": "#161413",
            "editorGutter.background": "#161413",
            "diffEditor.insertedTextBackground": "#5a7a4a33",
            "diffEditor.removedTextBackground": "#8a4a3a33",
          }
        : {
            "editor.background": "#ffffff",
            "editor.foreground": "#2b2724",
            "editor.lineHighlightBackground": "#f6f4f1",
          },
    });
  };
  define("codemind-dark", true);
  define("codemind-light", false);
}

/* ------------------------------------------------------------------ */
/* Command event contract (app-level keyboard mapping, Phase 6 §2)      */
/* ------------------------------------------------------------------ */

/** Commands the app can dispatch to the focused editor pane. */
export type EditorCommandId = "goto-line" | "quick-outline" | "find" | "replace";

/** Window event used by AIWorkspace key handlers to reach the active editor. */
export const EDITOR_COMMAND_EVENT = "cmx-editor-command";

export interface EditorCommandEventDetail {
  command: EditorCommandId;
}

/** Dispatch an editor command from anywhere (app keyboard layer). */
export function dispatchEditorCommand(command: EditorCommandId): void {
  window.dispatchEvent(
    new CustomEvent<EditorCommandEventDetail>(EDITOR_COMMAND_EVENT, {
      detail: { command },
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Active Monaco instance registry (Problems panel, quick outline UI)  */
/* ------------------------------------------------------------------ */

let activeMonaco: Monaco | null = null;

/** Called by the editor component on mount so panels can read markers. */
export function setActiveMonacoInstance(monaco: Monaco | null): void {
  activeMonaco = monaco;
  // Test/debug hook — read-only usage (markers inspection in verification).
  if (typeof window !== "undefined") {
    (window as unknown as { __cmxMonaco?: Monaco }).__cmxMonaco = monaco;
  }
}

/** The live Monaco instance (null until the first editor mounts). */
export function getActiveMonacoInstance(): Monaco | null {
  return activeMonaco;
}
