"use client";

/**
 * CodeMind X V2 — shared file-reference chip (V2.1 ADDITIONS §B).
 *
 * THE one component for rendering a reference to a repository file anywhere
 * in the product:
 *   AI chat (attachments + message references) · search results · approvals ·
 *   activity timeline · test failures · security findings.
 *
 * Rules:
 * - Clicking ALWAYS routes through the EditorNavigationService — never a
 *   bespoke open path.
 * - State badges use the shared SharedFileState vocabulary (§C). Unknown
 *   state = no badge, never a guessed one.
 * - The component never fetches anything; callers may pass already-known
 *   metadata only.
 */

import { memo } from "react";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type {
  EditorNavigationSource,
  SharedFileState,
} from "@/features/workspace/types";
import { FILE_STATE_META } from "@/features/workspace/types";
import { cn } from "@/lib/utils";

import { FileIcon } from "../repository/file-icons";

/** Dot/badge tone per shared file state (no blue/indigo per design contract). */
const STATE_DOT: Record<SharedFileState, string> = {
  clean: "text-transparent",
  modified: "text-amber-500",
  staged: "text-emerald-500",
  added: "text-emerald-500",
  deleted: "text-red-500",
  conflicted: "text-orange-500",
  locked: "text-stone-400",
  "read-only": "text-stone-400",
};

export interface FileReferenceChipProps {
  /** Workspace-relative file path. */
  path: string;
  /** 1-based target line (optional). */
  line?: number;
  /** 1-based end line for a range highlight (optional). */
  endLine?: number;
  /** Shared file state when actually known (§C). */
  state?: SharedFileState | null;
  /** Navigation source recorded for the audit trail. */
  source?: EditorNavigationSource;
  /** Compact rendering (chat inline) vs full (list rows). */
  size?: "sm" | "md";
  /**
   * Fuzzy-match positions (indexes into the FULL path string, from the
   * Phase 5 fuzzy scorer) — rendered as subtle <mark> highlights.
   */
  highlightPositions?: number[];
  className?: string;
}

function splitPath(path: string): { dir: string; name: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { dir: "", name: path };
  return { dir: path.slice(0, idx + 1), name: path.slice(idx + 1) };
}

export const FileReferenceChip = memo(function FileReferenceChip({
  path,
  line,
  endLine,
  state,
  source = "manual",
  size = "md",
  highlightPositions,
  className,
}: FileReferenceChipProps) {
  const { dir, name } = splitPath(path);
  const stateMeta = state ? FILE_STATE_META[state] : null;

  /** Highlight <mark> spans for the name part (positions are full-path based). */
  const nameContent =
    highlightPositions && highlightPositions.length > 0 ? (
      (() => {
        const set = new Set(highlightPositions);
        const parts: React.ReactNode[] = [];
        let buffer: string[] = [];
        let matched = set.has(dir.length);
        const flush = (key: string) => {
          if (buffer.length === 0) return;
          const chunk = buffer.join("");
          parts.push(
            matched ? (
              <mark key={key} className="rounded-sm bg-primary/20 text-inherit">
                {chunk}
              </mark>
            ) : (
              <span key={key}>{chunk}</span>
            ),
          );
          buffer = [];
        };
        for (let i = 0; i < name.length; i += 1) {
          const isMatch = set.has(dir.length + i);
          if (isMatch !== matched) {
            flush(`h${i}`);
            matched = isMatch;
          }
          buffer.push(name[i]);
        }
        flush("hend");
        return parts;
      })()
    ) : (
      name
    );

  const open = () => {
    const navigate = () => {
      // The editor workspace lives on the Assistant page — surface it when
      // the chip is clicked from another destination (search, git, …).
      const state = useWorkspaceStore.getState();
      if (state.section !== "assistant") state.setSection("assistant");
    };
    if (line && endLine && endLine > line) {
      void editorNavigation
        .openRange(path, line, endLine, source)
        .then((result) => {
          if (result.ok) navigate();
        });
      return;
    }
    void editorNavigation
      .open({
        filePath: path,
        line,
        sourceContext: source,
      })
      .then((result) => {
        if (result.ok) navigate();
      });
  };

  const title = [
    path,
    line ? `line ${line}${endLine && endLine > line ? `–${endLine}` : ""}` : null,
    stateMeta?.label ?? null,
    stateMeta?.note ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={open}
      title={title}
      data-file-chip={path}
      className={cn(
        "group inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border-subtle bg-surface-elevated/60",
        "font-mono transition-colors hover:border-primary/40 hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        size === "sm" ? "h-5 px-1.5 text-[10px]" : "h-6 px-2 text-[11px]",
        className,
      )}
    >
      <FileIcon name={name} className={size === "sm" ? "size-3" : "size-3.5"} />
      <span className="min-w-0 truncate">
        {dir ? <span className="text-muted-foreground/70">{dir}</span> : null}
        <span className="text-foreground/90">{nameContent}</span>
      </span>
      {line ? (
        <span className="shrink-0 text-muted-foreground">
          :{line}
          {endLine && endLine > line ? `-${endLine}` : ""}
        </span>
      ) : null}
      {state && state !== "clean" ? (
        <span
          aria-label={stateMeta?.label}
          className={cn("size-1.5 shrink-0 rounded-full bg-current", STATE_DOT[state])}
        />
      ) : null}
    </button>
  );
});
