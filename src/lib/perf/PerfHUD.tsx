"use client";

/**
 * CodeMind X V2 — performance HUD (V2.1 ADDITIONS §E).
 *
 * A small editor-status chip that renders the MEASURED numbers (p50/p95 of
 * keystroke latency, last large-file open, worker parse) against the honest
 * budgets. Shows "no samples yet" until real measurements exist — it never
 * displays invented numbers.
 */

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  getMeasuredMetrics,
  getPerfStats,
  type PerfMetric,
} from "@/lib/perf/records";

const METRIC_LABELS: Record<PerfMetric, string> = {
  "editor.keystroke": "Keystroke interaction",
  "editor.large-file-open": "Large-file open",
  "editor.model-create": "Model create/reuse",
  "worker.parse": "Worker parse",
  "search.query": "Search query",
};

function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 10) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

export function PerfHUD({ className }: { className?: string }) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setVersion((v) => v + 1), 2_000);
    return () => clearInterval(timer);
  }, []);

  void version; // re-render tick only

  const metrics = getMeasuredMetrics();
  const keystroke = getPerfStats("editor.keystroke");
  const headline =
    keystroke.last !== null
      ? `${keystroke.last < 10 ? keystroke.last.toFixed(1) : Math.round(keystroke.last)}ms`
      : null;
  const allOk = metrics.every((m) => getPerfStats(m).withinBudget !== false);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="perf-hud"
          aria-label={`Performance: ${headline ? `${headline} last keystroke` : "no samples yet"}`}
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            headline && !allOk && "text-amber-500",
            className,
          )}
        >
          <Gauge aria-hidden="true" className="size-3" />
          {headline ? <span className="tabular-nums">{headline}</span> : <span>perf</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 p-3">
        <p className="text-[11px] font-medium">Performance budgets — measured, live</p>
        {metrics.length === 0 ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            No samples yet. Type in the editor (keystroke latency) or run the
            large-file benchmark to collect real measurements.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {metrics.map((metric) => {
              const stats = getPerfStats(metric);
              return (
                <li key={metric} className="text-[10.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{METRIC_LABELS[metric]}</span>
                    <span
                      className={cn(
                        "rounded px-1 text-[9.5px] font-mono",
                        stats.withinBudget
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {stats.withinBudget ? "within budget" : "over budget"}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-muted-foreground tabular-nums">
                    last {formatMs(stats.last)} · p50 {formatMs(stats.p50)} · p95{" "}
                    {formatMs(stats.p95)} · max {formatMs(stats.max)}
                    <span className="text-muted-foreground/70"> (budget {stats.budget} ms)</span>
                  </div>
                  {stats.lastDetail ? (
                    <div className="mt-0.5 font-mono text-[9.5px] text-muted-foreground/80">
                      {Object.entries(stats.lastDetail)
                        .map(([key, value]) => `${key}=${typeof value === "number" && value > 1024 ? `${Math.round(value / 1024)}KB` : value}`)
                        .join(" · ")}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 border-t border-border-subtle pt-2 text-[10px] text-muted-foreground">
          Samples come from real interactions in this session. The 5 MB
          large-file benchmark runs through the production model+editor path.
        </p>
      </PopoverContent>
    </Popover>
  );
}
