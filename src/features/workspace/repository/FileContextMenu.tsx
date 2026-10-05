"use client";

/**
 * CodeMind X V2 — file context menu (Phase 5, spec §8).
 *
 * Right-click actions for tree rows and tab strips. Honest split per RULES.md
 * §9: actions with a real backing system run it; the rest are explicitly
 * labeled "[PLANNED]" and disabled — nothing pretends to work.
 *
 * REAL: Open · Copy path · Copy relative path · Explain with AI (queues the
 * file for the chat composer) · Git history (rail navigation).
 * PLANNED: references, symbols, review, tests, security (later phases).
 */

import { memo, type ReactNode } from "react";
import { Bot, GitBranch, History, Link2, ListTree, Lock, ShieldCheck, TestTube2 } from "lucide-react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { editorNavigation } from "@/features/workspace/editor-navigation";
import { useWorkspaceStore } from "@/stores/workspace-store";

export interface FileContextMenuProps {
  path: string;
  isDir: boolean;
  children: ReactNode;
}

async function copyText(value: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(message);
  } catch {
    toast.error("Clipboard unavailable in this browser context.");
  }
}

export const FileContextMenu = memo(function FileContextMenu({
  path,
  isDir,
  children,
}: FileContextMenuProps) {
  const queueChatFile = useWorkspaceStore((s) => s.queueChatFile);
  const setRepoRailView = useWorkspaceStore((s) => s.setRepoRailView);
  const revealInTree = useWorkspaceStore((s) => s.revealInTree);

  const open = () => {
    if (isDir) revealInTree(path);
    else void editorNavigation.open({ filePath: path, sourceContext: "manual" });
  };

  const planned = (label: string) => (
    <ContextMenuItem
      disabled
      title="Arrives in a later phase — not simulated."
      className="text-muted-foreground/60"
    >
      {label}
    </ContextMenuItem>
  );

  return (
    <ContextMenu>
      {/*
        Trigger wraps a plain div (NOT the row component directly): radix's
        asChild merges onContextMenu/ref onto the element it renders, and a
        memo component would silently drop them. The div is a transparent
        layout passthrough (the row button inside stays the focus/click
        target for normal interaction).
      */}
      <ContextMenuTrigger asChild>
        <div className="w-full">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={open}>{isDir ? "Reveal in tree" : "Open"}</ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void copyText(path, "Repository path copied")}
        >
          <span className="flex items-center gap-2">
            <Link2 aria-hidden="true" className="size-3.5" /> Copy path
          </span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void copyText(path, "Relative path copied")}
        >
          <span className="flex items-center gap-2">
            <Link2 aria-hidden="true" className="size-3.5" /> Copy relative path
          </span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {!isDir ? (
          <ContextMenuItem
            onSelect={() => {
              queueChatFile(path);
              toast.success("File attached to AI chat");
            }}
          >
            <span className="flex items-center gap-2">
              <Bot aria-hidden="true" className="size-3.5" /> Explain with AI
            </span>
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          onSelect={() => {
            setRepoRailView("git");
            toast("Opened Git Intelligence view");
          }}
        >
          <span className="flex items-center gap-2">
            <GitBranch aria-hidden="true" className="size-3.5" /> Git history
          </span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {!isDir ? planned("Search references [PLANNED]") : null}
        {!isDir ? (
          <ContextMenuItem disabled title="Arrives in a later phase — not simulated." className="text-muted-foreground/60">
            <span className="flex items-center gap-2">
              <ListTree aria-hidden="true" className="size-3.5" /> Find symbol [PLANNED]
            </span>
          </ContextMenuItem>
        ) : null}
        {!isDir ? planned("Review with AI [PLANNED]") : null}
        {!isDir ? (
          <ContextMenuItem disabled title="Arrives in a later phase — not simulated." className="text-muted-foreground/60">
            <span className="flex items-center gap-2">
              <TestTube2 aria-hidden="true" className="size-3.5" /> Generate tests [PLANNED]
            </span>
          </ContextMenuItem>
        ) : null}
        {!isDir ? (
          <ContextMenuItem disabled title="Arrives in a later phase — not simulated." className="text-muted-foreground/60">
            <span className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="size-3.5" /> Find security issues [PLANNED]
            </span>
          </ContextMenuItem>
        ) : null}
        {!isDir ? (
          <ContextMenuItem disabled title="Arrives in a later phase — not simulated." className="text-muted-foreground/60">
            <span className="flex items-center gap-2">
              <History aria-hidden="true" className="size-3.5" /> Per-file blame [PLANNED]
            </span>
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <div className="px-2 py-1 text-[10px] leading-snug text-muted-foreground/60">
          <Lock aria-hidden="true" className="mr-1 inline size-2.5" />
          Read-only workspace — write actions arrive with the rich editor.
        </div>
      </ContextMenuContent>
    </ContextMenu>
  );
});
