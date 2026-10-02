"use client";

/**
 * CodeMind X V2 — terminal / output panel (Phase 2, honest placeholder).
 *
 * There is no execution engine in Phase 2 — the panel says so instead of
 * faking output. The environment card lists only REAL facts about this build
 * (verified against package.json / project configuration).
 */

import { Info, SquareTerminal } from "lucide-react";

/** Real, verified facts about this build — nothing simulated. */
const ENVIRONMENT_FACTS: Array<[string, string]> = [
  ["runtime", "Bun"],
  ["framework", "Next.js 16 (App Router)"],
  ["ui", "React 19 · Tailwind 4 · shadcn/ui"],
  ["database", "SQLite via Prisma (configured)"],
  ["ai", "backend SDK assistant (connected)"],
];

export function TerminalOutputPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle px-2.5">
        <SquareTerminal className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Terminal / Output
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-[12px]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
          <span>No active execution — sandbox execution arrives in a later phase.</span>
        </div>

        <div className="space-y-1.5 rounded-md border border-border-subtle p-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Environment
          </span>
          <ul className="space-y-0.5">
            {ENVIRONMENT_FACTS.map(([label, value]) => (
              <li key={label} className="font-mono text-[11px] text-foreground/85">
                {label} · {value}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Real command output will stream here once the execution engine lands.
        </p>
      </div>
    </div>
  );
}
