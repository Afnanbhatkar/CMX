"use client";

/**
 * CodeMind X V2 — repository activity rail (Phase 2).
 *
 * 44px icon rail that switches the repository workspace view
 * (explorer / search / git / run / extensions) via the workspace store.
 * Every icon-only control carries a Tooltip + aria-label + focus-visible ring.
 */

import { Blocks, FolderTree, GitBranch, Play, Search, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { RepoRailView } from "@/stores/workspace-store";

export interface RepoActivityRailProps {
  /** Whether the diagnostics panel is currently shown (bottom split). */
  showDiagnostics: boolean;
  onToggleDiagnostics: () => void;
}

interface RailViewSpec {
  view: RepoRailView;
  label: string;
  icon: LucideIcon;
}

const RAIL_VIEWS: RailViewSpec[] = [
  { view: "explorer", label: "Explorer", icon: FolderTree },
  { view: "search", label: "Search", icon: Search },
  { view: "git", label: "Source Control", icon: GitBranch },
  { view: "run", label: "Run and Debug", icon: Play },
  { view: "extensions", label: "Extensions", icon: Blocks },
];

const RAIL_BUTTON_BASE = [
  "relative flex size-9 shrink-0 items-center justify-center rounded-md transition-colors",
  "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
] as const;

function RailButton({
  label,
  active,
  onSelect,
  children,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onSelect}
          className={cn(RAIL_BUTTON_BASE, active && "bg-primary/15 text-primary hover:text-primary")}
        >
          {active ? (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
            />
          ) : null}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function RepoActivityRail({ showDiagnostics, onToggleDiagnostics }: RepoActivityRailProps) {
  const repoRailView = useWorkspaceStore((s) => s.repoRailView);
  const setRepoRailView = useWorkspaceStore((s) => s.setRepoRailView);
  const setExplorerOpen = useWorkspaceStore((s) => s.setExplorerOpen);

  return (
    <nav
      aria-label="Repository activity rail"
      className="flex w-[44px] shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-surface py-2"
    >
      {RAIL_VIEWS.map(({ view, label, icon: Icon }) => (
        <RailButton
          key={view}
          label={label}
          active={repoRailView === view}
          onSelect={() => {
            setRepoRailView(view);
            // Focus-mode integration: picking the explorer or search view
            // also restores the file-tree column if it was closed.
            if (view === "explorer" || view === "search") setExplorerOpen(true);
          }}
        >
          <Icon className="size-4" aria-hidden="true" />
        </RailButton>
      ))}

      <div className="mt-auto flex flex-col items-center pt-1">
        <RailButton
          label="Diagnostics"
          active={showDiagnostics}
          onSelect={onToggleDiagnostics}
        >
          <Wrench className="size-4" aria-hidden="true" />
        </RailButton>
      </div>
    </nav>
  );
}
