"use client";

/**
 * CodeMind X V2 — BlastRadiusSlot (Phase 8C).
 *
 * A RESERVED visual area for the Phase 10/15 impact graph. It deliberately
 * renders NO graph today (RULES.md §9 — no fake data): only the four typed
 * slots the impact engine will later fill, each honestly showing "no data
 * yet". When Phase 10/15 lands, only this component changes.
 */

import { GitBranch, Network, ShieldAlert, TestTube2 } from "lucide-react";

const SLOTS: { key: string; label: string; icon: typeof Network; hint: string }[] = [
  { key: "modules", label: "Changed modules", icon: GitBranch, hint: "from the impact graph" },
  { key: "apis", label: "Affected APIs", icon: Network, hint: "call-graph reach" },
  { key: "tests", label: "Affected tests", icon: TestTube2, hint: "test-to-code map" },
  { key: "security", label: "Security dependencies", icon: ShieldAlert, hint: "advisory graph" },
];

export function BlastRadiusSlot() {
  return (
    <div
      role="group"
      aria-label="Blast radius (reserved for the Phase 10/15 impact graph)"
      className="rounded-lg border border-dashed border-border-subtle/80 bg-background/60 p-3"
      data-testid="blast-radius-slot"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground/80">Blast radius</span>
        <span className="rounded-full border border-border-subtle px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/80">
          reserved · Phase 10/15
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SLOTS.map(({ key, label, icon: Icon, hint }) => (
          <div
            key={key}
            className="flex min-h-[52px] flex-col justify-center gap-0.5 rounded-md border border-border-subtle/60 bg-surface-elevated/60 px-2.5 py-2"
          >
            <div className="flex items-center gap-1.5">
              <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/70" />
              <span className="truncate text-[11px] font-medium text-foreground/70">{label}</span>
            </div>
            <span className="pl-5 text-[10px] text-muted-foreground/70">
              no data yet · {hint}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
