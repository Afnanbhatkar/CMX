"use client";

/**
 * CodeMind X V2 — diagnostics panel (Phase 2, honest placeholder).
 *
 * No diagnostics engine is connected in Phase 2 — the panel states that
 * plainly and documents its extension point. No fabricated findings, counts
 * or severities.
 */

import { CircleAlert, Wrench } from "lucide-react";

export function DiagnosticsPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle px-2.5">
        <Wrench className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Diagnostics
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-[12px]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          <span>No diagnostics engine connected yet.</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Lint, typecheck and security findings will appear here in later phases.
        </p>
        <p className="text-[10px] text-muted-foreground/80">
          Extension point: a diagnostics provider registers findings for this panel — the UI is
          already wired and requires no changes.
        </p>
      </div>
    </div>
  );
}
