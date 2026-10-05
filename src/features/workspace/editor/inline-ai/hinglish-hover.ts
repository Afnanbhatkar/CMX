"use client";

/**
 * CodeMind X V2 — Hinglish hover (Phase 8.75 §5).
 *
 * An HONEST code-intelligence hover for the text-scan symbol outline: when
 * the hovered word matches a REAL text-scan symbol, the hover shows the
 * symbol's kind/name/line (labeled as a text-scan result, never a claimed
 * language server) plus an "Explain in Hinglish" command link that routes
 * through the SAME AI/context infrastructure (LLM Gateway via
 * POST /api/ai/explain). The explanation opens in a small overlay peek —
 * it never edits the buffer.
 */

import type { Monaco } from "@monaco-editor/react";
import type * as MonacoNS from "monaco-editor";

import { extractSymbols } from "../code-intelligence";

let registeredOnce = false;
let activeCommandId: string | null = null;

/** The hover needs a command id that exists per editor instance. */
export function setActiveHinglishCommand(id: string | null): void {
  activeCommandId = id;
}

export function registerHinglishHover(monaco: Monaco): void {
  if (registeredOnce) return;
  registeredOnce = true;

  const languages = ["typescript", "javascript", "python", "json"];
  for (const languageId of languages) {
    monaco.languages.registerHoverProvider(languageId, {
      provideHover(model, position) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const symbols = extractSymbols(model.getValue(), model.getLanguageId());
        const symbol = symbols.find((s) => s.name === word.word);
        if (!symbol) return null;

        const path = model.uri.path.replace(/^\//, "");
        const contents: MonacoNS.IMarkdownString[] = [
          {
            value: `**${symbol.kind} \`${symbol.name}\`** — line ${symbol.line} · text-scan outline (honest: not a language server)`,
          },
        ];
        if (activeCommandId) {
          const args = encodeURIComponent(
            JSON.stringify([{ path, line: symbol.line, symbol: symbol.name, kind: symbol.kind }]),
          );
          contents.push({
            value: `[Explain in Hinglish](command:${activeCommandId}?${args})`,
            isTrusted: true,
          });
        }
        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          ),
          contents,
        };
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Peek overlay (explanation surface — never edits the buffer)          */
/* ------------------------------------------------------------------ */

export interface HinglishPeekPayload {
  path: string;
  line: number;
  symbol: string;
  kind: string;
}

const PEEK_ID = "cmx.hinglishPeek";

export class HinglishPeek {
  private readonly editor: MonacoNS.editor.IStandaloneCodeEditor;
  private readonly monaco: Monaco;
  private runId = 0;

  private readonly node: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly visibleKey: MonacoNS.editor.IContextKey<boolean>;
  private added = false;

  constructor(editor: MonacoNS.editor.IStandaloneCodeEditor, monaco: Monaco) {
    this.editor = editor;
    this.monaco = monaco;
    this.visibleKey = editor.createContextKey<boolean>("cmxHinglishPeekVisible", false);

    this.node = document.createElement("div");
    this.node.className =
      "cmx-hinglish-peek rounded-md border border-[#3f3a33] bg-[#1d1a18] shadow-xl";
    this.node.style.cssText =
      "width:340px;max-height:280px;display:none;overflow:hidden;margin:8px 12px 0 0;";
    this.node.setAttribute("data-testid", "hinglish-peek");

    const header = document.createElement("div");
    header.className = "flex items-center gap-2 border-b border-[#2a2724] px-2 py-1";
    this.titleEl = document.createElement("span");
    this.titleEl.style.cssText =
      "flex:1;color:#d6a96a;font-size:10.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Close explanation");
    close.style.cssText =
      "cursor:pointer;border:none;background:transparent;color:#8a8378;font-size:11px;padding:0 2px;";
    close.addEventListener("click", () => this.hide());
    header.append(this.titleEl, close);

    this.bodyEl = document.createElement("div");
    this.bodyEl.style.cssText =
      "padding:8px 10px;color:#e8e4dd;font-size:11.5px;line-height:1.65;white-space:pre-wrap;overflow-y:auto;max-height:230px;font-family:var(--font-sans, inherit);";

    this.node.append(header, this.bodyEl);

    editor.addOverlayWidget({
      getId: () => PEEK_ID,
      getDomNode: () => this.node,
      getPosition: () => ({
        preference: monaco.editor.OverlayWidgetPositionPreference.TOP_RIGHT_CORNER,
      }),
    });
    this.added = true;

    editor.addCommand(monaco.KeyCode.Escape, () => this.hide(), "cmxHinglishPeekVisible");
  }

  show(payload: HinglishPeekPayload): void {
    if (!this.added) this.editor.addOverlayWidget(this.overlayWidgetShim());
    const runId = ++this.runId;
    this.titleEl.textContent = `${payload.kind} ${payload.symbol} — Hinglish`;
    this.bodyEl.textContent = "Soch raha hoon…";
    this.bodyEl.style.color = "#8a8378";
    this.node.style.display = "block";
    this.visibleKey.set(true);

    // Real symbol source: lines around the symbol in the CURRENT model.
    const model = this.editor.getModel();
    let code = payload.symbol;
    if (model && model.uri.path.replace(/^\//, "") === payload.path) {
      const start = Math.max(1, payload.line - 8);
      const end = Math.min(model.getLineCount(), payload.line + 12);
      code = model.getValueInRange({
        startLineNumber: start,
        startColumn: 1,
        endLineNumber: end,
        endColumn: model.getLineMaxColumn(end),
      });
    }

    void (async () => {
      try {
        const response = await fetch("/api/ai/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: payload.path,
            language: model?.getLanguageId() ?? "plaintext",
            symbol: payload.symbol,
            kind: payload.kind,
            line: payload.line,
            code,
          }),
        });
        const data = (await response.json()) as {
          ok: boolean;
          explanation?: string;
          error?: string;
        };
        if (runId !== this.runId) return; // superseded / closed
        if (data.ok && typeof data.explanation === "string") {
          this.bodyEl.textContent = data.explanation;
          this.bodyEl.style.color = "#e8e4dd";
        } else {
          this.bodyEl.textContent = data.error ?? "The explanation request failed.";
          this.bodyEl.style.color = "#d8b4a4";
        }
      } catch (error) {
        if (runId !== this.runId) return;
        this.bodyEl.textContent =
          error instanceof Error
            ? `The explanation request failed: ${error.message}`
            : "The explanation request failed.";
        this.bodyEl.style.color = "#d8b4a4";
      }
    })();
  }

  hide(): void {
    this.runId += 1;
    this.node.style.display = "none";
    this.visibleKey.set(false);
  }

  private overlayWidgetShim(): MonacoNS.editor.IOverlayWidget {
    return {
      getId: () => PEEK_ID,
      getDomNode: () => this.node,
      getPosition: () => ({
        preference: this.monaco.editor.OverlayWidgetPositionPreference.TOP_RIGHT_CORNER,
      }),
    };
  }

  dispose(): void {
    this.hide();
    if (this.added) this.editor.removeOverlayWidget(this.overlayWidgetShim());
    this.added = false;
  }
}
