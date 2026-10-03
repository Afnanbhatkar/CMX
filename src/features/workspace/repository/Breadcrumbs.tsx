"use client";

/**
 * CodeMind X V2 — editor breadcrumbs (Phase 5, spec §7).
 *
 * Renders `src / auth / session.ts` style segments above the editor. Directory
 * segments are buttons that navigate where meaningful — they reveal the
 * directory inside the explorer tree (store revealInTree). The file segment is
 * the current location (plain text). More than four segments collapse the
 * middle into an expandable "…" control.
 */

import { memo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface BreadcrumbsProps {
  path: string;
  /** Called with the directory prefix path when a directory segment is clicked. */
  onNavigateDir?: (dirPath: string) => void;
}

export const Breadcrumbs = memo(function Breadcrumbs({ path, onNavigateDir }: BreadcrumbsProps) {
  const [expanded, setExpanded] = useState(false);
  const segments = path.split("/").filter((s) => s.length > 0);

  if (segments.length === 0) return null;

  const fileIndex = segments.length - 1;
  const COLLAPSED_VISIBLE = 4;
  const collapseCount = segments.length - COLLAPSED_VISIBLE;
  const shouldCollapse = collapseCount > 1 && !expanded;

  // Visible segment indices when collapsed: first 2, "…", last 2.
  const visible: Array<{ index: number; label: string }> = [];
  if (shouldCollapse) {
    for (let i = 0; i < 2; i += 1) visible.push({ index: i, label: segments[i] });
    visible.push({ index: -1, label: "…" });
    for (let i = fileIndex - 1; i <= fileIndex; i += 1) visible.push({ index: i, label: segments[i] });
  } else {
    segments.forEach((label, index) => visible.push({ index, label }));
  }

  return (
    <nav aria-label="File path" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
      {visible.map((segment, position) => {
        const isEllipsis = segment.index === -1;
        const isFile = segment.index === fileIndex;
        const dirPath =
          !isEllipsis && !isFile ? segments.slice(0, segment.index + 1).join("/") : null;

        return (
          <span key={`${segment.index}-${position}`} className="flex min-w-0 items-center gap-0.5">
            {position > 0 ? (
              <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/50" />
            ) : null}
            {isEllipsis ? (
              <button
                type="button"
                aria-label="Show full path"
                onClick={() => setExpanded(true)}
                className={cn(
                  "rounded px-1 py-0.5 text-[11px] text-muted-foreground",
                  "hover:bg-surface-hover hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                …
              </button>
            ) : isFile ? (
              <span
                className="min-w-0 truncate px-1 py-0.5 font-mono text-[11px] text-foreground/90"
                title={path}
              >
                {segment.label}
              </span>
            ) : (
              <button
                type="button"
                disabled={dirPath === null || !onNavigateDir}
                onClick={() => {
                  if (dirPath && onNavigateDir) onNavigateDir(dirPath);
                }}
                title={dirPath ? `Reveal ${dirPath} in the explorer` : segment.label}
                className={cn(
                  "min-w-0 max-w-[180px] truncate rounded px-1 py-0.5 text-[11px] text-muted-foreground",
                  "hover:bg-surface-hover hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  "disabled:pointer-events-none",
                )}
              >
                {segment.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
});
