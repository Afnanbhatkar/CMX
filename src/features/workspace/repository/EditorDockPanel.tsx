"use client";

/**
 * CodeMind X V2 — editor dock panel (Phase 6 §6 + V2.1 ADDITIONS §D).
 *
 * The extensible bottom dock of the editor area. REAL anchors:
 * - Problems  — the live marker set of the ACTIVE file from Monaco's language
 *   workers (single-file syntax analysis; nothing fabricated). Clicking a
 *   problem opens the location via the EditorNavigationService.
 * - Terminal  — the honest Phase 2 output placeholder (no execution engine).
 *
 * RESERVED anchors (V2.1 §D — added without redesigning this dock):
 * - Context Inspector, Git Timeline — disabled extension slots with honest
 *   notes. File intelligence stays its own right-hand panel; CodeLens has a
 *   registered provider anchor in code-intelligence.ts.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  GitCommitVertical,
  Info,
  ScanSearch,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type * as MonacoNS from "monaco-editor";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import {
  getActiveMonacoInstance,
  type EditorCommandId,
} from "@/features/workspace/editor/monaco-setup";
import {
  getIntelligenceCapability,
} from "@/features/workspace/editor/code-intelligence";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { TerminalOutputPanel } from "./TerminalOutputPanel";

/* ------------------------------------------------------------------ */
/* Dock registry (the extensible anchor list)                          */
/* ------------------------------------------------------------------ */

export type DockPanelId = "problems" | "terminal" | "context-inspector" | "git-timeline";

export interface DockPanelAnchor {
  id: DockPanelId;
  label: string;
  icon: typeof Wrench;
  availability: "available" | "planned";
  /** Honest note for planned anchors. */
  note?: string;
}

/** Adding a future panel = ONE entry here + a render branch. No redesign. */
export const EDITOR_DOCK_PANELS: DockPanelAnchor[] = [
  { id: "problems", label: "Problems", icon: CircleAlert, availability: "available" },
  { id: "terminal", label: "Terminal", icon: SquareTerminal, availability: "available" },
  {
    id: "context-inspector",
    label: "Context Inspector",
    icon: ScanSearch,
    availability: "planned",
    note: "Live AI-context inspection (attachments, selection, retrieved files) arrives with the context engineering phase.",
  },
  {
    id: "git-timeline",
    label: "Git Timeline",
    icon: GitCommitVertical,
    availability: "planned",
    note: "File-scoped commit timeline view arrives with the git intelligence phase (per-file history already lives in File Intelligence).",
  },
];

/* ------------------------------------------------------------------ */
/* Problems panel (REAL Monaco markers)                                */
/* ------------------------------------------------------------------ */

interface ProblemRow {
  path: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  source: string | null;
  code: string | null;
}

const SEVERITY_ICON = {
  error: CircleAlert,
  warning: Info,
  info: CircleDashed,
} as const;

const SEVERITY_CLASS = {
  error: "text-red-500",
  warning: "text-amber-500",
  info: "text-muted-foreground",
} as const;

function readMarkers(activePath: string | null): ProblemRow[] {
  const monaco = getActiveMonacoInstance();
  if (!monaco || !activePath) return [];
  const markers = monaco.editor.getModelMarkers({});
  const rows: ProblemRow[] = [];
  for (const marker of markers) {
    // Model URIs are scheme-less paths (or /prefixed) — match the active
    // workspace path robustly, never by guesswork.
    const resourcePath = (marker.resource?.path ?? "").replace(/^\//, "");
    const isForActiveFile =
      resourcePath === activePath ||
      resourcePath.endsWith(`/${activePath}`) ||
      (!resourcePath && markers.length === 1);
    if (!isForActiveFile) continue;
    const severity: ProblemRow["severity"] =
      marker.severity === monaco.MarkerSeverity.Error
        ? "error"
        : marker.severity === monaco.MarkerSeverity.Warning
          ? "warning"
          : "info";
    rows.push({
      path: activePath,
      line: marker.startLineNumber,
      column: marker.startColumn,
      severity,
      message: marker.message,
      source: marker.owner ?? null,
      code: marker.code ? String(marker.code) : null,
    });
  }
  return rows.slice(0, 200);
}

function ProblemsPanel() {
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const [rows, setRows] = useState<ProblemRow[]>([]);
  const [markersSupported, setMarkersSupported] = useState(true);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: ReturnType<typeof MonacoNS.editor.onDidChangeMarkers> | null = null;

    const refresh = () => {
      if (disposed) return;
      setRows(readMarkers(activeTabPath));
    };

    const attach = () => {
      const monaco = getActiveMonacoInstance();
      if (!monaco) {
        setMarkersSupported(false);
        return;
      }
      setMarkersSupported(true);
      refresh();
      unsubscribe = monaco.editor.onDidChangeMarkers(() => refresh());
    };

    // Yield first so no state update happens synchronously inside the effect
    // body (react-hooks/set-state-in-effect).
    void (async () => {
      await Promise.resolve();
      if (disposed) return;
      attach();
    })();

    return () => {
      disposed = true;
      unsubscribe?.dispose();
    };
  }, [activeTabPath]);

  const errors = rows.filter((r) => r.severity === "error").length;
  const warnings = rows.filter((r) => r.severity === "warning").length;
  const infos = rows.length - errors - warnings;

  const openProblem = (row: ProblemRow) => {
    void editorNavigation.openRange(row.path, row.line, row.line, "manual");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="problems-panel">
      <div className="flex items-center gap-3 border-b border-border-subtle px-3 py-1.5 text-[10.5px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <CircleAlert aria-hidden="true" className={cn("size-3", errors > 0 && "text-red-500")} />
          {errors} errors
        </span>
        <span className="flex items-center gap-1">
          <Info aria-hidden="true" className={cn("size-3", warnings > 0 && "text-amber-500")} />
          {warnings} warnings
        </span>
        <span className="flex items-center gap-1">
          <CircleDashed aria-hidden="true" className="size-3" />
          {infos} infos
        </span>
        <span className="ml-auto truncate" title="Single-file syntax analysis from the Monaco TS/JS workers">
          source: single-file syntax analysis
        </span>
      </div>

      {!markersSupported ? (
        <div className="flex items-center gap-2 p-3 text-[11px] text-muted-foreground">
          <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
          Open a text file in the editor to analyze it.
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-2 p-3 text-[11px] text-muted-foreground">
          <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden="true" />
          No syntax problems detected in the active file.
        </div>
      ) : (
        <ul className="min-h-0 flex-1 list-none space-y-0.5 overflow-y-auto p-1.5" style={{ maxHeight: "100%" }}>
          {rows.map((row, index) => {
            const Icon = SEVERITY_ICON[row.severity];
            return (
              <li key={`${row.path}:${row.line}:${row.column}:${index}`}>
                <button
                  type="button"
                  onClick={() => openProblem(row)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-[11px]",
                    "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn("mt-0.5 size-3.5 shrink-0", SEVERITY_CLASS[row.severity])}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground/90">{row.message}</span>
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                      {row.path}:{row.line}:{row.column}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Planned diagnostic categories — honest [PLANNED], no invented rows. */}
      <div className="flex flex-wrap gap-1.5 border-t border-border-subtle px-3 py-1.5">
        {(["diagnostics-lint", "diagnostics-type", "diagnostics-security", "diagnostics-ai"] as const).map(
          (feature) => {
            const capability = getIntelligenceCapability(feature);
            return (
              <Tooltip key={feature}>
                <TooltipTrigger asChild>
                  <span className="cursor-not-allowed rounded border border-border-subtle px-1.5 py-0.5 text-[10px] text-muted-foreground/60 select-none">
                    {feature.replace("diagnostics-", "")} · planned
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64 text-[10.5px]">{capability.reason}</TooltipContent>
              </Tooltip>
            );
          },
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Planned anchor body                                                 */
/* ------------------------------------------------------------------ */

function PlannedAnchorBody({ note }: { note: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center">
      <div className="flex max-w-sm flex-col items-center gap-1.5">
        <CircleDashed aria-hidden="true" className="size-5 text-muted-foreground/50" />
        <p className="text-[11px] text-muted-foreground">{note}</p>
        <p className="text-[10px] text-muted-foreground/70">
          Reserved anchor — wired into the dock registry, nothing simulated.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The dock                                                            */
/* ------------------------------------------------------------------ */

export interface EditorDockPanelProps {
  /** Dock tab switched externally (repo rail diagnostics toggle). */
  requestedTab?: DockPanelId | null;
}

export function EditorDockPanel({ requestedTab }: EditorDockPanelProps) {
  const [active, setActive] = useState<DockPanelId>("terminal");

  useEffect(() => {
    if (!requestedTab) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setActive(requestedTab);
    })();
    return () => {
      cancelled = true;
    };
  }, [requestedTab]);

  const activeAnchor = useMemo(
    () => EDITOR_DOCK_PANELS.find((p) => p.id === active) ?? EDITOR_DOCK_PANELS[0]!,
    [active],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Editor dock panels" className="flex h-8 shrink-0 items-stretch border-b border-border-subtle">
        {EDITOR_DOCK_PANELS.map((panel) => {
          const available = panel.availability === "available";
          const isActive = available && active === panel.id;
          const body = (
            <span
              className={cn(
                "flex h-full items-center gap-1.5 px-3 text-[11px]",
                isActive
                  ? "border-b-2 border-primary text-foreground"
                  : available
                    ? "text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground/50",
              )}
            >
              <panel.icon aria-hidden="true" className="size-3.5" />
              {panel.label}
              {!available ? <span aria-hidden="true">·</span> : null}
            </span>
          );
          return available ? (
            <button
              key={panel.id}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => setActive(panel.id)}
              className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {body}
            </button>
          ) : (
            <Tooltip key={panel.id}>
              <TooltipTrigger asChild>
                <span aria-disabled="true" className="flex h-full cursor-not-allowed items-center">
                  {body}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 text-[10.5px]">
                {panel.note}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeAnchor.id === "problems" ? <ProblemsPanel /> : null}
        {activeAnchor.id === "terminal" ? <TerminalOutputPanel /> : null}
        {activeAnchor.availability === "planned" ? (
          <PlannedAnchorBody note={activeAnchor.note ?? "Planned anchor."} />
        ) : null}
      </div>
    </div>
  );
}
