"use client";

/**
 * CodeMind X V2 — AI chat panel (spec §13).
 *
 * The main assistant surface: header with the REAL current conversation title
 * + status chip, then either the honest empty state or the live conversation
 * with the composer underneath. No model names, no fake activity — the panel
 * only ever shows what the store actually holds.
 */

import { Plus, Sparkles } from "lucide-react";

import { selectActiveConversation, useWorkspaceStore } from "@/stores/workspace-store";
import type { ConversationStatus } from "@/features/workspace/types";
import { LatticeLoader } from "@/components/ai";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConversationView } from "./ConversationView";
import { AIComposer } from "./AIComposer";

/** Status → chip tone (real statuses only, honest labels). */
const STATUS_CHIP: Record<
  ConversationStatus,
  { label: string; dot: string; chip: string }
> = {
  active: {
    label: "Active",
    dot: "bg-primary",
    chip: "border-primary/40 text-primary",
  },
  generating: {
    label: "Generating",
    dot: "bg-primary animate-pulse motion-reduce:animate-none",
    chip: "border-primary/40 text-primary",
  },
  completed: {
    label: "Completed",
    dot: "bg-success",
    chip: "border-success/40 text-success",
  },
  stopped: {
    label: "Stopped",
    dot: "bg-warning",
    chip: "border-warning/40 text-warning",
  },
  error: {
    label: "Failed",
    dot: "bg-danger",
    chip: "border-danger/40 text-danger",
  },
};

function StatusChip({ status }: { status: ConversationStatus }) {
  const meta = STATUS_CHIP[status];
  return (
    <Badge
      variant="outline"
      className={`shrink-0 gap-1 border-border-subtle px-1.5 py-0 text-[10px] ${meta.chip}`}
    >
      {status === "generating" ? (
        <LatticeLoader cellSize={3} label="Generating" />
      ) : (
        <span aria-hidden="true" className={`size-1.5 rounded-full ${meta.dot}`} />
      )}
      {meta.label}
    </Badge>
  );
}

export function AIChatPanel() {
  const activeConversation = useWorkspaceStore(selectActiveConversation);
  const newConversation = useWorkspaceStore((s) => s.newConversation);
  const requestComposerFocus = useWorkspaceStore((s) => s.requestComposerFocus);

  const startNewChat = () => {
    newConversation();
    requestComposerFocus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium">
            {activeConversation?.title ?? "Assistant"}
          </span>
          {activeConversation && <StatusChip status={activeConversation.status} />}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="New chat"
              onClick={startNewChat}
              className="size-7 shrink-0 rounded-[6px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              <Plus aria-hidden="true" className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New chat</TooltipContent>
        </Tooltip>
      </header>

      {/* The composer is ALWAYS visible (spec §25): with no active
          conversation, sending from it starts a new conversation. */}
      {activeConversation ? (
        <ConversationView conversationId={activeConversation.id} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-lg border border-border-subtle p-8 text-center">
            <Sparkles aria-hidden="true" className="mx-auto size-6 text-muted-foreground/60" />
            <h2 className="mt-3 text-[13px] font-medium">No active conversation</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Ask anything about software engineering — English, Hindi or Hinglish.
            </p>
            <Button type="button" size="sm" onClick={startNewChat} className="mt-4">
              Start New Chat
            </Button>
          </div>
        </div>
      )}
      <AIComposer />
    </div>
  );
}
