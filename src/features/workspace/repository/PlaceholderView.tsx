"use client";

/**
 * CodeMind X V2 — honest placeholder view for planned rail views
 * (used by "run" and "extensions" in Phase 2).
 *
 * A wired extension point: the view exists, is reachable and labelled — and
 * states plainly that nothing is simulated.
 */

import type { LucideIcon } from "lucide-react";

export interface PlaceholderViewProps {
  title: string;
  icon: LucideIcon;
  /** What is (not yet) available — honest, specific. */
  note: string;
  /** Extension-point disclaimer. */
  detail: string;
}

export function PlaceholderView({ title, icon: Icon, note, detail }: PlaceholderViewProps) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-elevated">
          <Icon className="size-4.5 text-primary/80" aria-hidden="true" />
        </span>
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="text-[12px] text-muted-foreground">{note}</p>
        <p className="text-[11px] text-muted-foreground/70">{detail}</p>
      </div>
    </div>
  );
}
