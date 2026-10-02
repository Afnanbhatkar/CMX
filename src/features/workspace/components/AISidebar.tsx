"use client";

/**
 * CodeMind X V2 — destination sidebar (the "CodeMind X" panel).
 *
 * Two presentations:
 * - "panel": full navigation used inside the desktop CodeMind X panel and the
 *   compact nav Sheet. While the desktop panel is collapsed (store state) the
 *   same instance renders the compact icon-rail presentation with an expand
 *   control, so the rail-sized panel always shows a usable UI.
 * - "rail": persistent 48px icon rail for tablet widths (≥768px).
 *
 * Every destination routes through `setSection`; planned destinations show an
 * honest "arrives in a later phase" placeholder in the chat area (RULES §9).
 * The footer only surfaces REAL state: repository meta, the current AI run
 * phase and actual stored conversations.
 */

import { useMemo } from "react";
import { PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import { LogoMark } from "@/features/site/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/stores/workspace-store";

import { WORKSPACE_DESTINATIONS, type DestinationEntry } from "../registry";
import { useRepositoryMeta } from "../use-repository-meta";
import type { AIRunPhase } from "../types";

export interface AISidebarProps {
  variant: "panel" | "rail";
}

/** Run phases that represent a live AI run (copper pulsing dot). */
const ACTIVE_RUN_PHASES: ReadonlySet<AIRunPhase> = new Set<AIRunPhase>([
  "thinking",
  "searching",
  "reading",
  "planning",
  "coding",
  "testing",
  "reviewing",
  "waiting-approval",
]);

function runDotClass(phase: AIRunPhase): string {
  if (ACTIVE_RUN_PHASES.has(phase)) {
    return "bg-primary animate-pulse motion-reduce:animate-none";
  }
  if (phase === "failed") return "bg-danger";
  if (phase === "completed") return "bg-success";
  // idle | cancelled
  return "bg-muted-foreground/50";
}

const railButtonClass =
  "relative flex size-9 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60";

/* ------------------------------------------------------------------ */
/* Rail presentation (collapsed desktop panel OR persistent tablet rail) */
/* ------------------------------------------------------------------ */

function RailPresentation({ showExpand }: { showExpand: boolean }) {
  const section = useWorkspaceStore((s) => s.section);
  const setSection = useWorkspaceStore((s) => s.setSection);
  const toggleCmx = useWorkspaceStore((s) => s.toggleCmx);

  // Settings is pinned to the bottom of the rail, so it is excluded from the
  // scrolling destination list here (the panel presentation keeps it inline).
  const railDestinations = useMemo(
    () => WORKSPACE_DESTINATIONS.filter((d) => d.id !== "settings"),
    [],
  );

  return (
    <div className="flex h-full w-[48px] shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-surface py-2">
      {showExpand ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Expand sidebar"
              onClick={toggleCmx}
              className={cn(
                railButtonClass,
                "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand sidebar</TooltipContent>
        </Tooltip>
      ) : (
        <LogoMark withWordmark={false} className="mb-1" />
      )}

      <nav
        aria-label="CodeMind X destinations"
        className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-1"
      >
        {railDestinations.map((destination) => {
          const active = section === destination.id;
          return (
            <Tooltip key={destination.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={destination.label}
                  aria-current={active ? "true" : undefined}
                  onClick={() => setSection(destination.id)}
                  className={cn(
                    railButtonClass,
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary"
                    />
                  )}
                  <destination.icon className="size-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{destination.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Settings"
            aria-current={section === "settings" ? "true" : undefined}
            onClick={() => setSection("settings")}
            className={cn(
              railButtonClass,
              section === "settings"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {section === "settings" && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary"
              />
            )}
            <Settings className="size-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Settings</TooltipContent>
      </Tooltip>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel presentation (full navigation)                                */
/* ------------------------------------------------------------------ */

function PanelPresentation() {
  const section = useWorkspaceStore((s) => s.section);
  const setSection = useWorkspaceStore((s) => s.setSection);
  const toggleCmx = useWorkspaceStore((s) => s.toggleCmx);
  const runPhase = useWorkspaceStore((s) => s.runPhase);
  const conversations = useWorkspaceStore((s) => s.conversations);
  const setActiveConversation = useWorkspaceStore((s) => s.setActiveConversation);
  const { meta, loading: metaLoading } = useRepositoryMeta();

  /** Top 3 conversations by last activity — real persisted state only. */
  const recentConversations = useMemo(
    () =>
      [...conversations]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 3),
    [conversations],
  );

  const repositoryLabel = metaLoading
    ? "Loading…"
    : (meta?.repository.name ?? "Not connected");

  return (
    <div className="flex h-full w-full flex-col bg-surface">
      <header className="flex h-11 shrink-0 items-center justify-between px-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          CodeMind X
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Collapse sidebar"
              onClick={toggleCmx}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Collapse sidebar</TooltipContent>
        </Tooltip>
      </header>

      <nav
        aria-label="CodeMind X destinations"
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1"
      >
        {WORKSPACE_DESTINATIONS.map((destination: DestinationEntry) => {
          const active = section === destination.id;
          const planned = destination.availability === "planned";
          return (
            <button
              key={destination.id}
              type="button"
              aria-current={active ? "true" : undefined}
              title={
                planned
                  ? `${destination.label} — ${destination.note ?? "Arrives in a later phase."}`
                  : undefined
              }
              onClick={() => setSection(destination.id)}
              className={cn(
                "relative flex h-8 w-full items-center gap-2.5 rounded-md px-3 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60",
                active
                  ? "bg-primary/15 text-primary"
                  : "text-foreground/85 hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary"
                />
              )}
              <destination.icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{destination.label}</span>
              {/* Planned marker: compact dot (label stays readable at 11%
                  width); the full note is in the row tooltip + destination
                  panel. Marked via aria-label suffix for screen readers. */}
              {planned && (
                <span
                  aria-hidden="true"
                  className="ml-auto size-1.5 shrink-0 rounded-full border border-muted-foreground/50"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer — compact REAL workspace info only (no fabricated data). */}
      <footer className="mt-auto shrink-0 space-y-1.5 border-t border-border-subtle p-2 text-[11px]">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
            Active repository
          </div>
          <div className="truncate text-foreground/90">{repositoryLabel}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
            Current run
          </div>
          <div className="flex items-center gap-1.5 text-foreground/90">
            <span
              aria-hidden="true"
              className={cn("size-1.5 shrink-0 rounded-full", runDotClass(runPhase))}
            />
            <span className="truncate">{runPhase}</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
            Recent
          </div>
          {recentConversations.length === 0 ? (
            <div className="text-muted-foreground">No conversations yet</div>
          ) : (
            <div className="space-y-0.5 pt-0.5">
              {recentConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setActiveConversation(conversation.id)}
                  className="block w-full truncate rounded text-left text-foreground/85 transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                >
                  {conversation.title ?? "Untitled conversation"}
                </button>
              ))}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

export function AISidebar({ variant }: AISidebarProps) {
  // While the desktop CodeMind X panel is collapsed, the panel-sized instance
  // switches to the rail presentation (with an expand control at the top).
  const cmxCollapsed = useWorkspaceStore((s) => s.collapsed.cmx);

  if (variant === "rail") {
    return <RailPresentation showExpand={false} />;
  }
  if (cmxCollapsed) {
    return <RailPresentation showExpand />;
  }
  return <PanelPresentation />;
}
