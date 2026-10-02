"use client";

/**
 * CodeMind X V2 — slim resize handle between workspace panels.
 *
 * Wraps the shadcn `ResizableHandle` (which is never edited) with:
 * - a 12px invisible pointer hit area (negative-inset ::after),
 * - copper hover/drag feedback,
 * - an explanatory aria-label — arrow-key resizing is built into
 *   react-resizable-panels.
 *
 * `disabled` is passed straight through so the handle before a collapsed
 * sidebar cannot be dragged.
 */

import { ResizableHandle } from "@/components/ui/resizable";

export interface PanelResizerProps {
  /** Disable dragging — used for the handle before a collapsed sidebar. */
  disabled?: boolean;
}

export function PanelResizer({ disabled = false }: PanelResizerProps) {
  return (
    <ResizableHandle
      disabled={disabled}
      aria-label="Resize panels — use arrow keys to adjust"
      className={
        "w-px bg-border-subtle transition-colors hover:bg-primary/40 data-[resize-handle-state=drag]:bg-primary/70 data-[resize-handle-active]:bg-primary/70 " +
        // 12px invisible hit area. The explicit left/w/translate utilities
        // neutralize the centered 4px ::after utilities of the ui primitive
        // (tw-merge cannot remove cross-group base utilities), so the hit
        // area geometry is deterministic.
        "after:absolute after:inset-y-0 after:-inset-x-1.5 after:left-[-6px] after:w-auto after:translate-x-0 after:content-['']"
      }
    />
  );
}
