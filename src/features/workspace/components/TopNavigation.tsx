"use client";

/**
 * CodeMind X V2 — top navigation bar (h-12) of the workspace shell.
 *
 * Surfaces only REAL state: the repository name/branch come from the meta
 * API, indexing is honestly labeled "unavailable" with its real note, and the
 * run indicator reflects the actual store `runPhase`. The compact-only
 * buttons (<1024px) open the responsive Sheets owned by `AIWorkspace`.
 */

import {
  Bell,
  Command as CommandIcon,
  Database,
  FolderGit2,
  GitBranch,
  Menu,
  MessageSquare,
  Search,
  Settings as SettingsIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { LogoMark } from "@/features/site/logo";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useRepositoryMeta } from "../use-repository-meta";
import type { AIRunPhase } from "../types";

export interface TopNavigationProps {
  /**
   * Opens the command palette. `true` opens it directly in file-search mode
   * (same state the ⌘K / ⌘P shortcuts drive through `AIWorkspace`).
   */
  onOpenPalette: (filesMode: boolean) => void;
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

const iconButtonClass =
  "size-8 rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/60";

const kbdClass =
  "inline-flex h-4 select-none items-center rounded border border-border-subtle bg-surface-elevated px-1 font-mono text-[10px] font-medium text-muted-foreground";

/** Real AI run phase indicator — a status element, not an action button. */
function RunIndicator() {
  const runPhase = useWorkspaceStore((s) => s.runPhase);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={`AI run: ${runPhase}`}
          className="flex size-8 items-center justify-center rounded-md"
        >
          <span
            aria-hidden="true"
            className={cn("size-2 rounded-full", runDotClass(runPhase))}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>AI run: {runPhase}</TooltipContent>
    </Tooltip>
  );
}

export function TopNavigation({ onOpenPalette }: TopNavigationProps) {
  const { meta, loading: metaLoading } = useRepositoryMeta();
  const setSection = useWorkspaceStore((s) => s.setSection);
  const setNavSheetOpen = useWorkspaceStore((s) => s.setNavSheetOpen);
  const setChatSidebarSheetOpen = useWorkspaceStore((s) => s.setChatSidebarSheetOpen);
  const setRepoSheetOpen = useWorkspaceStore((s) => s.setRepoSheetOpen);

  const branch = meta?.repository.branch ?? null;
  const indexingNote =
    meta?.indexing.note ?? "Repository indexing has no status to report yet.";

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle bg-surface px-3">
      {/* LEFT — brand + repository chip */}
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        <LogoMark withWordmark={false} />
        <span className="hidden text-sm font-semibold whitespace-nowrap sm:inline">
          CodeMind X
        </span>
        <Separator
          orientation="vertical"
          className="hidden shrink-0 data-[orientation=vertical]:h-5 sm:block"
        />
        {metaLoading ? (
          <Skeleton className="h-4 w-24" />
        ) : !meta ? (
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
            No repository selected
          </span>
        ) : (
          <span className="hidden min-w-0 items-center gap-1.5 text-xs text-foreground/90 sm:flex">
            <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="max-w-[180px] truncate">{meta.repository.name}</span>
          </span>
        )}
      </div>

      {/* CENTER — branch + honest indexing status (≥1280px only) */}
      <div className="hidden min-w-0 flex-1 items-center justify-center gap-2 xl:flex">
        <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-border-subtle bg-surface-elevated px-2 py-1">
          <GitBranch className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {branch ? (
            <span className="max-w-[220px] truncate font-mono text-xs">{branch}</span>
          ) : (
            <span className="text-xs text-muted-foreground">Not connected</span>
          )}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex shrink-0 cursor-default items-center gap-1.5 rounded-md border border-border-subtle bg-surface-elevated px-2 py-1 text-xs text-muted-foreground">
              <Database className="size-3.5" aria-hidden="true" />
              Indexing unavailable
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{indexingNote}</TooltipContent>
        </Tooltip>
      </div>

      {/* RIGHT — always-available actions */}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search files"
              className={iconButtonClass}
              onClick={() => onOpenPalette(true)}
            >
              <Search className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search files (⌘P)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              aria-label="Command palette"
              className={cn(
                "hidden h-8 gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/60 md:inline-flex",
              )}
              onClick={() => onOpenPalette(false)}
            >
              <CommandIcon className="size-4" aria-hidden="true" />
              {/* Shortcut hint — Ctrl works in addition to ⌘ (see Settings). */}
              <kbd className={kbdClass}>⌘K</kbd>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Command palette</TooltipContent>
        </Tooltip>

        <RunIndicator />

        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Notifications"
                  className={iconButtonClass}
                >
                  <Bell className="size-4" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Notifications</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-64 p-3">
            <p className="text-sm font-medium">Notifications</p>
            <p className="mt-1.5 text-sm text-foreground/85">No notifications.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Notifications arrive in a later phase.
            </p>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open settings"
              className={iconButtonClass}
              onClick={() => setSection("settings")}
            >
              <SettingsIcon className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>

        {/* COMPACT-only (<1024px) — responsive sheet openers */}
        <Separator
          orientation="vertical"
          className="shrink-0 data-[orientation=vertical]:h-5 lg:hidden"
        />
        <div className="flex items-center gap-1 lg:hidden">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open navigation"
                className={iconButtonClass}
                onClick={() => setNavSheetOpen(true)}
              >
                <Menu className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Navigation</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open AI chats"
                className={iconButtonClass}
                onClick={() => setChatSidebarSheetOpen(true)}
              >
                <MessageSquare className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>AI chats</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open repository"
                className={iconButtonClass}
                onClick={() => setRepoSheetOpen(true)}
              >
                <FolderGit2 className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Repository</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}