"use client";

/**
 * CodeMind X V2 — Cmd/Ctrl+K inline edit (Phase 8.75 §3/§4).
 *
 * Flow: select code → Cmd/Ctrl+K → instruction input (content widget) →
 * gateway proposal (POST /api/ai/inline-edit) → INLINE DIFF rendered as a
 * view zone below the selection → Accept / Reject.
 *
 * SHADOW BUFFER (§4): the proposal is NEVER applied silently. It lives in
 * the view-zone preview only; an explicit human Accept writes it to the
 * IN-MEMORY Monaco model via executeEdits (this build has no disk-write
 * path at all), Reject/Escape/any buffer change discards it.
 */

import type { Monaco } from "@monaco-editor/react";
import type * as MonacoNS from "monaco-editor";

import { recordEditorEdit } from "./inline-ai-context";

const MAX_DIFF_ROWS = 14;

type DiffRow = { type: "ctx" | "del" | "add"; text: string };

/** Classic LCS line diff — small, dependency-free, correct. */
export function diffLines(a: string, b: string): DiffRow[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const n = aLines.length;
  const m = bLines.length;
  // LCS table (selections are ≤8k chars → rows/cols stay small).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = aLines[i] === bLines[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      rows.push({ type: "ctx", text: aLines[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ type: "del", text: aLines[i]! });
      i += 1;
    } else {
      rows.push({ type: "add", text: bLines[j]! });
      j += 1;
    }
  }
  while (i < n) rows.push({ type: "del", text: aLines[i++]! });
  while (j < m) rows.push({ type: "add", text: bLines[j++]! });
  return rows;
}

const WIDGET_ID = "cmx.inlineEdit.widget";

export class InlineEditController {
  private readonly editor: MonacoNS.editor.IStandaloneCodeEditor;
  private readonly monaco: Monaco;
  private readonly getPath: () => string;
  private readonly getLanguage: () => string;

  private state: "idle" | "input" | "loading" | "proposal" = "idle";
  private runId = 0;
  private anchorLine = 1;
  private originalRange: MonacoNS.Range | null = null;
  private originalText = "";
  private proposalText = "";
  private zoneId: string | null = null;
  private decorations: string[] = [];
  private applying = false;

  private readonly contentNode: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private readonly hintEl: HTMLElement;
  private readonly widget: MonacoNS.editor.IContentWidget;
  private readonly proposalVisibleKey: MonacoNS.editor.IContextKey<boolean>;

  private readonly contentListener: MonacoNS.IDisposable | null;

  constructor(
    editor: MonacoNS.editor.IStandaloneCodeEditor,
    monaco: Monaco,
    getPath: () => string,
    getLanguage: () => string,
  ) {
    this.editor = editor;
    this.monaco = monaco;
    this.getPath = getPath;
    this.getLanguage = getLanguage;

    this.proposalVisibleKey = editor.createContextKey<boolean>(
      "cmxInlineEditProposalVisible",
      false,
    );

    // --- instruction input (content widget) ---
    const root = document.createElement("div");
    root.className =
      "cmx-inline-edit-root flex items-center gap-2 rounded-md border border-[#3f3a33] bg-[#1d1a18] px-2 py-1.5 shadow-lg";
    root.style.width = "min(520px, 60vw)";
    root.setAttribute("data-testid", "inline-edit-input");

    const icon = document.createElement("span");
    icon.textContent = "✦";
    icon.style.color = "#d6a96a";
    icon.style.fontSize = "12px";

    this.inputEl = document.createElement("input");
    this.inputEl.type = "text";
    this.inputEl.placeholder = "Tell AI what to change… (Enter generate · Esc cancel)";
    this.inputEl.spellcheck = false;
    this.inputEl.style.cssText =
      "flex:1;background:transparent;border:none;outline:none;color:#e8e4dd;font-size:12px;font-family:var(--font-mono, ui-monospace), monospace;";
    this.inputEl.setAttribute("aria-label", "Inline AI edit instruction");

    this.hintEl = document.createElement("span");
    this.hintEl.style.cssText =
      "color:#8a8378;font-size:10.5px;white-space:nowrap;flex-shrink:0;";
    this.hintEl.textContent = "";

    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        void this.submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.dismiss();
      }
    });

    root.append(icon, this.inputEl, this.hintEl);
    this.contentNode = root;

    this.widget = {
      getId: () => WIDGET_ID,
      getDomNode: () => this.contentNode,
      getPosition: () => {
        if (this.state === "idle" || this.state === "proposal") return null;
        return {
          position: { lineNumber: this.anchorLine, column: 1 },
          preference: [monaco.editor.ContentWidgetPositionPreference.BELOW],
        };
      },
    };
    editor.addContentWidget(this.widget);

    // While a proposal is visible: Esc rejects, Ctrl/Cmd+Enter accepts.
    editor.addCommand(
      monaco.KeyCode.Escape,
      () => this.reject(),
      "cmxInlineEditProposalVisible",
    );
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => this.accept(),
      "cmxInlineEditProposalVisible",
    );

    // Any user edit invalidates an open flow (stale proposal must die).
    this.contentListener = editor.onDidChangeModelContent(() => {
      if (this.applying) return;
      if (this.state !== "idle") this.dismiss();
    });
  }

  /** Open the instruction input for the current selection (§3). */
  startFromSelection(): void {
    if (this.state !== "idle") this.dismiss();
    const model = this.editor.getModel();
    const selection = this.editor.getSelection();
    if (!model || !selection || selection.isEmpty()) return;

    this.runId += 1;
    this.originalRange = new this.monaco.Range(
      selection.startLineNumber,
      selection.startColumn,
      selection.endLineNumber,
      selection.endColumn,
    );
    this.originalText = model.getValueInRange(selection);
    this.anchorLine = selection.startLineNumber;
    this.state = "input";
    this.inputEl.disabled = false;
    this.inputEl.value = "";
    this.hintEl.textContent = "";
    this.inputEl.focus();
    this.editor.layoutContentWidget(this.widget);
  }

  private async submit(): Promise<void> {
    const instruction = this.inputEl.value.trim();
    const model = this.editor.getModel();
    if (!instruction || !model || !this.originalRange) return;

    const runId = ++this.runId;
    this.state = "loading";
    this.inputEl.disabled = true;
    this.hintEl.textContent = "Generating edit…";

    const value = model.getValue();
    const beforeStart = model.getOffsetAt({
      lineNumber: this.originalRange.startLineNumber,
      column: 1,
    });
    const afterStart = model.getOffsetAt({
      lineNumber: this.originalRange.endLineNumber,
      column: model.getLineMaxColumn(this.originalRange.endLineNumber),
    });
    const prefixContext = value.slice(Math.max(0, beforeStart - 800), beforeStart);
    const suffixContext = value.slice(afterStart, afterStart + 400);

    try {
      const response = await fetch("/api/ai/inline-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: this.getPath(),
          language: this.getLanguage(),
          instruction,
          code: this.originalText,
          prefixContext: prefixContext.slice(-800),
          suffixContext,
        }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        replacement?: string;
        error?: string;
      };
      // Stale guard: user changed the buffer / closed the widget meanwhile.
      if (runId !== this.runId || this.state !== "loading") return;
      if (!data.ok || typeof data.replacement !== "string") {
        this.inputEl.disabled = false;
        this.hintEl.textContent = data.error ?? "The edit request failed.";
        this.state = "input";
        return;
      }
      this.showProposal(data.replacement);
    } catch (error) {
      if (runId !== this.runId) return;
      this.inputEl.disabled = false;
      this.hintEl.textContent =
        error instanceof Error ? `The edit request failed: ${error.message}` : "The edit request failed.";
      this.state = "input";
    }
  }

  private showProposal(text: string): void {
    const monaco = this.monaco;
    const editor = this.editor;
    const range = this.originalRange;
    if (!range) return;

    this.proposalText = text;
    const rows = diffLines(this.originalText, text);
    const changed = rows.filter((r) => r.type !== "ctx").length;
    if (changed === 0) {
      this.inputEl.disabled = false;
      this.hintEl.textContent = "The model returned an identical selection.";
      this.state = "input";
      return;
    }

    // --- proposal zone (shadow buffer: preview only) ---
    const zone = document.createElement("div");
    zone.className =
      "cmx-inline-edit-proposal rounded-md border border-[#3f3a33] bg-[#161413] overflow-y-auto";
    zone.style.height = "100%";
    zone.setAttribute("data-testid", "inline-edit-proposal");

    const header = document.createElement("div");
    header.className =
      "flex items-center gap-2 border-b border-[#2a2724] bg-[#1d1a18] px-2 py-1";
    const label = document.createElement("span");
    label.style.cssText = "color:#b3aa9c;font-size:10.5px;flex:1;";
    label.textContent = `AI proposed edit — ${changed} changed line(s) · proposal only, nothing written`;
    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.textContent = "Accept";
    acceptBtn.setAttribute("data-testid", "inline-edit-accept");
    acceptBtn.style.cssText =
      "cursor:pointer;border:none;border-radius:4px;background:#3f5a35;color:#e8f0dd;font-size:10.5px;padding:2px 8px;";
    acceptBtn.addEventListener("click", () => this.accept());
    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.textContent = "Reject";
    rejectBtn.setAttribute("data-testid", "inline-edit-reject");
    rejectBtn.style.cssText =
      "cursor:pointer;border:1px solid #3f3a33;border-radius:4px;background:transparent;color:#b3aa9c;font-size:10.5px;padding:2px 8px;";
    rejectBtn.addEventListener("click", () => this.reject());
    header.append(label, acceptBtn, rejectBtn);
    zone.append(header);

    for (const row of rows.slice(0, 200)) {
      const line = document.createElement("div");
      const sign = row.type === "add" ? "+" : row.type === "del" ? "-" : " ";
      line.textContent = `${sign} ${row.text}`;
      line.style.cssText =
        "font-family:var(--font-mono, ui-monospace), monospace;font-size:11.5px;line-height:1.6;white-space:pre;padding:0 8px;";
      if (row.type === "add") {
        line.style.background = "rgba(90, 122, 74, 0.22)";
        line.style.color = "#c6d8b4";
      } else if (row.type === "del") {
        line.style.background = "rgba(138, 74, 58, 0.20)";
        line.style.color = "#d8b4a4";
        line.style.textDecoration = "line-through";
        line.style.textDecorationColor = "rgba(216, 180, 164, 0.5)";
      } else {
        line.style.color = "#6b6459";
      }
      zone.append(line);
    }

    const zoneHeight = Math.min(rows.length, MAX_DIFF_ROWS) + 1;
    editor.changeViewZones((accessor) => {
      this.zoneId = accessor.addZone({
        afterLineNumber: range.endLineNumber,
        heightInLines: zoneHeight,
        domNode: zone,
      });
    });

    this.decorations = editor.deltaDecorations(this.decorations, [
      {
        range,
        options: {
          isWholeLine: true,
          className: "cmx-inline-edit-pending",
        },
      },
    ]);

    this.state = "proposal";
    this.proposalVisibleKey.set(true);
    this.editor.layoutContentWidget(this.widget);
    this.editor.focus();
  }

  /** Explicit human accept → writes to the IN-MEMORY model ONLY (§4). */
  accept(): void {
    if (this.state !== "proposal" || !this.originalRange) return;
    const model = this.editor.getModel();
    if (!model) return;
    this.applying = true;
    try {
      this.editor.executeEdits("cmx-inline-edit", [
        {
          range: this.originalRange,
          text: this.proposalText,
          forceMoveMarkers: false,
        },
      ]);
      recordEditorEdit(this.getPath(), this.proposalText.length);
    } finally {
      this.applying = false;
    }
    this.cleanup();
    this.editor.focus();
  }

  reject(): void {
    this.cleanup();
    this.editor.focus();
  }

  /** Any state → back to idle (input, loading, or proposal). */
  dismiss(): void {
    this.runId += 1;
    this.cleanup();
  }

  private cleanup(): void {
    if (this.zoneId !== null) {
      const zoneId = this.zoneId;
      this.editor.changeViewZones((accessor) => accessor.removeZone(zoneId));
      this.zoneId = null;
    }
    this.decorations = this.editor.deltaDecorations(this.decorations, []);
    this.state = "idle";
    this.proposalVisibleKey.set(false);
    this.inputEl.disabled = false;
    this.hintEl.textContent = "";
    this.editor.layoutContentWidget(this.widget);
  }

  dispose(): void {
    this.dismiss();
    this.contentListener?.dispose();
    this.editor.removeContentWidget(this.widget);
  }
}
