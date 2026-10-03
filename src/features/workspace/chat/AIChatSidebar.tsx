"use client";

/**
 * CodeMind X V2 — AI chat sidebar (spec §12).
 *
 * Conversation management over REAL local state: current/pinned/recent/
 * archived lists with real timestamps and statuses, honest AI context values,
 * the shared run-phase indicator, and quick actions that prefill the composer
 * draft. Planned capabilities (mode chips) are rendered as typed extension
 * points — never as fake features (RULES.md §9).
 *
 * Note on the context snapshot: values are projected as PRIMITIVES from
 * `selectWorkspaceContext` because zustand v5 selectors must return stable
 * references (a fresh snapshot object per call would break getSnapshot).
 */

import { useMemo, useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  ChevronDown,
  Command,
  FileCode2,
  History,
  ListTree,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  SearchX,
  Sparkles,
  Star,
} from "lucide-react";

import {
  selectActiveConversation,
  selectWorkspaceContext,
  useWorkspaceStore,
} from "@/stores/workspace-store";
import type {
  AIRunPhase,
  Conversation,
  ConversationStatus,
} from "@/features/workspace/types";
import { editorNavigation } from "@/features/workspace/editor-navigation";
import { useRepositoryMeta } from "@/features/workspace/use-repository-meta";
import { ThinkingOrb } from "@/components/ai";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChatUiStore } from "./chat-ui-store";
import { cn } from "@/lib/utils";

export interface AIChatSidebarProps {
  /** Rendered inside a Sheet on compact layouts: no collapse control. */
  embedded?: boolean;
}

/* ------------------------------------------------------------------ */
/* Status presentation (real statuses only)                            */
/* ------------------------------------------------------------------ */

const STATUS_META: Record<
  ConversationStatus,
  { label: string; dot: string; badge: string }
> = {
  active: {
    label: "Active",
    dot: "bg-primary",
    badge: "border-primary/40 text-primary",
  },
  generating: {
    label: "Generating",
    dot: "bg-primary animate-pulse motion-reduce:animate-none",
    badge: "border-primary/40 text-primary",
  },
  completed: {
    label: "Completed",
    dot: "bg-success",
    badge: "border-success/40 text-success",
  },
  stopped: {
    label: "Stopped",
    dot: "bg-warning",
    badge: "border-warning/40 text-warning",
  },
  error: {
    label: "Failed",
    dot: "bg-danger",
    badge: "border-danger/40 text-danger",
  },
};

/** Real relative time from updatedAt; honest fallback for invalid data. */
function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return formatDistanceToNow(date, { addSuffix: true });
}

function titleCasePhase(phase: AIRunPhase): string {
  return phase
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Conversation row                                                    */
/* ------------------------------------------------------------------ */

interface ConversationRowProps {
  conversation: Conversation;
  active: boolean;
  onOpen: (id: string) => void;
  onRename: (conversation: Conversation) => void;
  onDelete: (conversation: Conversation) => void;
  onTogglePin: (id: string) => void;
  onToggleArchive: (id: string) => void;
}

function ConversationRow({
  conversation,
  active,
  onOpen,
  onRename,
  onDelete,
  onTogglePin,
  onToggleArchive,
}: ConversationRowProps) {
  const meta = STATUS_META[conversation.status];
  const title = conversation.title ?? "Untitled conversation";

  return (
    <div
      className={cn(
        "group relative flex items-center rounded-md transition-colors",
        active ? "bg-primary/10" : "hover:bg-surface-hover",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-primary"
        />
      )}
      <button
        type="button"
        onClick={() => onOpen(conversation.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 pl-2 pr-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
      >
        <span className="min-w-0 flex-1 truncate text-xs" title={title}>
          {title}
        </span>
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Conversation actions for ${title}`}
            className="size-5 shrink-0 rounded-[4px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal aria-hidden="true" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40 text-xs">
          <DropdownMenuItem onClick={() => onOpen(conversation.id)}>Open</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onRename(conversation)}>Rename</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onTogglePin(conversation.id)}>
            {conversation.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onToggleArchive(conversation.id)}>
            {conversation.archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onDelete(conversation)}
            className="text-danger focus:bg-danger/10 focus:text-danger"
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

const RESERVED_MODES = ["Search", "Code", "Agent", "Loop"] as const;

function ReservedModeChip({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-disabled="true"
          className="cursor-not-allowed select-none rounded border border-border-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/60"
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>Available in a later phase</TooltipContent>
    </Tooltip>
  );
}

export function AIChatSidebar({ embedded = false }: AIChatSidebarProps) {
  const collapsedChatSidebar = useWorkspaceStore(
    (s) => s.collapsed.chatSidebar,
  );

  /* Collapsed desktop panel → independent functional icon rail (spec §15).
     The embedded (Sheet) instance always shows the full sidebar. */
  if (!embedded && collapsedChatSidebar) {
    return <ChatRailPresentation />;
  }

  return <ChatSidebarContent embedded={embedded} />;
}

/* ------------------------------------------------------------------ */
/* Collapsed icon rail (spec §15)                                      */
/* ------------------------------------------------------------------ */

const railButtonClass =
  "relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 aria-[current=true]:bg-primary/15 aria-[current=true]:text-primary";

function RailDot({ className, pulse = false }: { className: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute right-1.5 top-1.5 size-1.5 rounded-full",
        className,
        pulse && "animate-pulse motion-reduce:animate-none",
      )}
    />
  );
}

function ChatRailPresentation() {
  const activeConversation = useWorkspaceStore(selectActiveConversation);
  const pinnedCount = useWorkspaceStore(
    (s) => s.conversations.filter((c) => c.pinned && !c.archived).length,
  );
  const recentCount = useWorkspaceStore(
    (s) =>
      s.conversations.filter((c) => !c.pinned && !c.archived).length,
  );
  const runPhase = useWorkspaceStore((s) => s.runPhase);
  const activeFile = useWorkspaceStore((s) => s.activeTabPath);

  const newConversation = useWorkspaceStore((s) => s.newConversation);
  const setActiveConversation = useWorkspaceStore((s) => s.setActiveConversation);
  const toggleChatSidebar = useWorkspaceStore((s) => s.toggleChatSidebar);
  const openSheet = useWorkspaceStore((s) => s.setChatSidebarSheetOpen);
  const requestComposerFocus = useWorkspaceStore((s) => s.requestComposerFocus);

  const statusMeta = activeConversation ? STATUS_META[activeConversation.status] : null;
  const runDot =
    runPhase === "thinking"
      ? "bg-primary"
      : runPhase === "failed"
        ? "bg-danger"
        : "bg-muted-foreground/50";

  const openCurrent = () => {
    if (activeConversation) {
      setActiveConversation(activeConversation.id);
      requestComposerFocus();
    } else {
      newConversation();
      requestComposerFocus();
    }
  };

  return (
    <div
      className="flex h-full w-full flex-col items-center gap-1 border-r border-border-subtle bg-surface py-2"
      role="navigation"
      aria-label="AI chats — collapsed rail"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Expand sidebar"
            onClick={toggleChatSidebar}
            className="size-9 rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <PanelLeftOpen aria-hidden="true" className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Expand sidebar</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={railButtonClass}
            aria-label="New Chat"
            onClick={() => {
              newConversation();
              requestComposerFocus();
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">New Chat</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={railButtonClass}
            aria-label={
              activeConversation
                ? `Current chat — ${activeConversation.title ?? "Untitled conversation"}`
                : "Current chat — no active conversation"
            }
            aria-current={activeConversation ? "true" : undefined}
            onClick={openCurrent}
          >
            <Sparkles aria-hidden="true" className="size-4" />
            {statusMeta ? (
              <RailDot
                className={statusMeta.dot}
                pulse={activeConversation?.status === "generating"}
              />
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-[220px]">
          {activeConversation
            ? (activeConversation.title ?? "Untitled conversation")
            : "No active conversation — start one"}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={railButtonClass}
            aria-label={`Recent conversations (${recentCount})`}
            onClick={() => openSheet(true)}
          >
            <History aria-hidden="true" className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          Recent conversations ({recentCount}) — open panel
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={railButtonClass}
            aria-label={`Pinned conversations (${pinnedCount})`}
            onClick={() => openSheet(true)}
          >
            <Star aria-hidden="true" className="size-4" />
            {pinnedCount > 0 ? <RailDot className="bg-warning" /> : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          Pinned conversations ({pinnedCount}) — open panel
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={railButtonClass}
            aria-label={
              activeFile
                ? `AI context — active file: ${activeFile}`
                : "AI context — no active file"
            }
            onClick={() => openSheet(true)}
          >
            <Command aria-hidden="true" className="size-4" />
            {activeFile ? <RailDot className="bg-primary" /> : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-[220px]">
          {activeFile ? `AI context — ${activeFile}` : "AI context — no active file"}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={railButtonClass}
            aria-label={`Current run — ${titleCasePhase(runPhase)}`}
            onClick={() => openSheet(true)}
          >
            <Activity aria-hidden="true" className="size-4" />
            <RailDot className={runDot} pulse={runPhase === "thinking"} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          Current run — {titleCasePhase(runPhase)}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={railButtonClass}
            aria-label="Search conversations"
            onClick={() => openSheet(true)}
          >
            <Search aria-hidden="true" className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Search conversations — open panel</TooltipContent>
      </Tooltip>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Expanded sidebar content                                            */
/* ------------------------------------------------------------------ */

function ChatSidebarContent({ embedded = false }: AIChatSidebarProps) {
  const conversations = useWorkspaceStore((s) => s.conversations);
  const activeConversation = useWorkspaceStore(selectActiveConversation);
  const runPhase = useWorkspaceStore((s) => s.runPhase);
  /* Primitive projections of the workspace context snapshot (stable refs). */
  const contextActiveFile = useWorkspaceStore(
    (s) => selectWorkspaceContext(s).activeFile,
  );
  const contextAttachmentCount = useWorkspaceStore(
    (s) => selectWorkspaceContext(s).attachments.length,
  );

  const newConversation = useWorkspaceStore((s) => s.newConversation);
  const setActiveConversation = useWorkspaceStore((s) => s.setActiveConversation);
  const renameConversation = useWorkspaceStore((s) => s.renameConversation);
  const deleteConversation = useWorkspaceStore((s) => s.deleteConversation);
  const togglePinConversation = useWorkspaceStore((s) => s.togglePinConversation);
  const toggleArchiveConversation = useWorkspaceStore((s) => s.toggleArchiveConversation);
  const toggleChatSidebar = useWorkspaceStore((s) => s.toggleChatSidebar);
  const requestComposerFocus = useWorkspaceStore((s) => s.requestComposerFocus);
  const setSection = useWorkspaceStore((s) => s.setSection);

  const { meta } = useRepositoryMeta();
  const setDraft = useChatUiStore((s) => s.setDraft);

  const [search, setSearch] = useState("");
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);

  const trimmedSearch = search.trim().toLowerCase();
  const isSearching = trimmedSearch.length > 0;

  const { pinned, recent, archived, searchMatched } = useMemo(() => {
    const byUpdated = (a: Conversation, b: Conversation) =>
      b.updatedAt.localeCompare(a.updatedAt);

    const nonArchived = conversations.filter((c) => !c.archived);
    // Search covers labelled data only: title OR any real message content.
    // Archived conversations are intentionally excluded from search.
    const matched = isSearching
      ? nonArchived.filter(
          (c) =>
            (c.title ?? "").toLowerCase().includes(trimmedSearch) ||
            c.messages.some((m) => m.content.toLowerCase().includes(trimmedSearch)),
        )
      : nonArchived;

    return {
      pinned: matched.filter((c) => c.pinned).sort(byUpdated),
      recent: matched.filter((c) => !c.pinned).sort(byUpdated),
      archived: conversations.filter((c) => c.archived).sort(byUpdated),
      searchMatched: matched.length,
    };
  }, [conversations, isSearching, trimmedSearch]);

  const startNewChat = () => {
    newConversation();
    requestComposerFocus();
  };

  const openActiveFile = () => {
    if (!contextActiveFile) return;
    void editorNavigation.open({
      filePath: contextActiveFile,
      sourceContext: "chat",
      navigationReason: "AI context — active file",
    });
  };

  const askAboutCurrentFile = () => {
    if (!contextActiveFile) return;
    setDraft(`Explain what the file ${contextActiveFile} does.`);
    requestComposerFocus();
  };

  const summarizeContext = () => {
    setDraft("Summarize the current workspace context and what I can do here.");
    requestComposerFocus();
  };

  const submitRename = () => {
    if (renameTarget) {
      renameConversation(renameTarget.id, renameValue);
    }
    setRenameTarget(null);
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteConversation(deleteTarget.id);
    }
    setDeleteTarget(null);
  };

  const rowHandlers = {
    onOpen: setActiveConversation,
    onRename: (conversation: Conversation) => {
      setRenameValue(conversation.title ?? "");
      setRenameTarget(conversation);
    },
    onDelete: (conversation: Conversation) => setDeleteTarget(conversation),
    onTogglePin: togglePinConversation,
    onToggleArchive: toggleArchiveConversation,
  };

  return (
    <div className="@container flex h-full flex-col bg-surface">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle px-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          AI Chats
        </span>
        {!embedded && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Collapse sidebar"
                onClick={toggleChatSidebar}
                className="size-7 rounded-[6px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              >
                <PanelLeftClose aria-hidden="true" className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Collapse sidebar</TooltipContent>
          </Tooltip>
        )}
      </header>

      <div className="space-y-2 p-2">
        <Button
          type="button"
          size="default"
          onClick={startNewChat}
          className="w-full justify-start gap-2 text-xs"
        >
          <Plus aria-hidden="true" className="size-4" />
          New Chat
        </Button>

        {/* Conversation search — labels + message text only (distinct from code search). */}
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="text"
            role="searchbox"
            aria-label="Search conversations"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search conversations…"
            className="h-8 pl-7 text-xs md:text-xs"
          />
        </div>
      </div>

      {/*
       * Plain overflow container — NOT a Radix ScrollArea. The Radix
       * viewport wraps content in `display: table; min-width: 100%`, which
       * sizes children to their content width instead of the panel width:
       * at narrow (11%) sidebar widths cards and buttons overflowed and
       * got clipped instead of wrapping. Block layout wraps correctly.
       */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 px-2 pb-2">
          {/* Current conversation */}
          <section className="space-y-1">
            <SectionLabel>Current</SectionLabel>
            {activeConversation ? (
              <div className="rounded-md border border-border-subtle bg-surface-elevated p-2">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="min-w-0 truncate text-[13px] font-medium"
                    title={activeConversation.title ?? "Untitled conversation"}
                  >
                    {activeConversation.title ?? "Untitled conversation"}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 gap-1 px-1.5 py-0 text-[10px]",
                      STATUS_META[activeConversation.status].badge,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 rounded-full",
                        STATUS_META[activeConversation.status].dot,
                      )}
                    />
                    {STATUS_META[activeConversation.status].label}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Assistant · {relativeTime(activeConversation.updatedAt)}
                </p>
                {/* Honest provider label — no model names are invented. */}
                <p className="mt-0.5 text-[11px] text-muted-foreground/80">Local assistant</p>
              </div>
            ) : (
              <div className="rounded-md border border-border-subtle p-2 text-center">
                <Sparkles
                  aria-hidden="true"
                  className="mx-auto size-4 text-muted-foreground/60"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">No active conversation</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={startNewChat}
                  className="mt-2 h-6 px-2 text-[11px]"
                >
                  Start New Chat
                </Button>
              </div>
            )}
          </section>

          {/* Lists */}
          {isSearching && searchMatched === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-md border border-border-subtle px-2 py-4 text-center">
              <SearchX aria-hidden="true" className="size-4 text-muted-foreground/60" />
              <p className="text-[11px] text-muted-foreground">No conversations match</p>
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <section className="space-y-1">
                  <SectionLabel>Pinned</SectionLabel>
                  <div className="space-y-0.5">
                    {pinned.map((conversation) => (
                      <ConversationRow
                        key={conversation.id}
                        conversation={conversation}
                        active={conversation.id === activeConversation?.id}
                        {...rowHandlers}
                      />
                    ))}
                  </div>
                </section>
              )}

              {recent.length > 0 && (
                <section className="space-y-1">
                  <SectionLabel>Recent</SectionLabel>
                  <div className="space-y-0.5">
                    {recent.map((conversation) => (
                      <ConversationRow
                        key={conversation.id}
                        conversation={conversation}
                        active={conversation.id === activeConversation?.id}
                        {...rowHandlers}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {/* Archived — excluded from search, collapsed by default */}
          {!isSearching && archived.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md px-1 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80 transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60">
                <span>Archived ({archived.length})</span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-3 transition-transform duration-200 motion-reduce:transition-none group-data-[state=open]:rotate-180"
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 space-y-0.5">
                  {archived.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      active={conversation.id === activeConversation?.id}
                      {...rowHandlers}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {!isSearching &&
            pinned.length === 0 &&
            recent.length === 0 &&
            archived.length === 0 && (
              <p className="px-1 py-2 text-center text-[11px] text-muted-foreground">
                No conversations yet
              </p>
            )}

          {/* AI workspace context — real values only, never fabricated */}
          <section className="space-y-1">
            <SectionLabel>AI Context</SectionLabel>
            <dl className="space-y-1 rounded-md border border-border-subtle bg-surface-elevated p-2 text-[11px]">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="shrink-0 text-muted-foreground">Repository</dt>
                <dd className="min-w-0 truncate text-right" title={meta?.repository.name ?? undefined}>
                  {meta?.repository.name ?? "Not connected"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="shrink-0 text-muted-foreground">Branch</dt>
                <dd className="min-w-0 truncate text-right" title={meta?.repository.branch ?? undefined}>
                  {meta?.repository.branch ?? "Not connected"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="shrink-0 text-muted-foreground">Active file</dt>
                <dd className="flex min-w-0 flex-wrap items-center justify-end gap-1 text-right">
                  {contextActiveFile ? (
                    <>
                      <button
                        type="button"
                        onClick={openActiveFile}
                        aria-label={`Open ${contextActiveFile} in editor`}
                        title={contextActiveFile}
                        className="flex min-w-0 items-center gap-1 rounded-[4px] font-mono text-[11px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                      >
                        <FileCode2 aria-hidden="true" className="size-3 shrink-0" />
                        <span className="truncate">{contextActiveFile}</span>
                      </button>
                      <button
                        type="button"
                        onClick={openActiveFile}
                        aria-label={`Open ${contextActiveFile} in editor`}
                        className="shrink-0 rounded-[4px] text-[10px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                      >
                        Open in editor
                      </button>
                    </>
                  ) : (
                    <span className="text-muted-foreground/70">None</span>
                  )}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="shrink-0 text-muted-foreground">Selected code</dt>
                <dd className="text-right text-muted-foreground/70">
                  {/* Phase 2 has no selection tracking — honest placeholder. */}
                  —
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="shrink-0 text-muted-foreground">Attachments</dt>
                <dd className="text-right">
                  {contextAttachmentCount > 0 ? contextAttachmentCount : "None"}
                </dd>
              </div>
            </dl>
          </section>

          {/* Current AI run — shared run-phase contract */}
          <section className="space-y-1">
            <SectionLabel>Current Run</SectionLabel>
            <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-elevated p-2 text-[11px]">
              {runPhase === "thinking" ? (
                <>
                  <ThinkingOrb size={18} state="thinking" label="AI run thinking" />
                  <span>Thinking</span>
                </>
              ) : (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      runPhase === "failed"
                        ? "bg-danger"
                        : "bg-muted-foreground/50",
                    )}
                  />
                  <span className={runPhase === "idle" ? "text-muted-foreground" : undefined}>
                    {runPhase === "idle" ? "Idle" : titleCasePhase(runPhase)}
                  </span>
                </>
              )}
            </div>
            <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
              Run states follow the shared AI run contract — execution engines arrive
              in later phases.
            </p>
          </section>

          {/* Quick actions */}
          <section className="space-y-1">
            <SectionLabel>Quick Actions</SectionLabel>
            <div className="grid grid-cols-1 gap-1.5 @min-[240px]:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                onClick={requestComposerFocus}
                className="h-7 min-w-0 justify-start gap-1.5 px-2 text-[11px]"
              >
                <Sparkles aria-hidden="true" className="size-3 shrink-0" />
                <span className="min-w-0 truncate">Ask AI</span>
              </Button>

              {contextActiveFile ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={askAboutCurrentFile}
                  title="Ask about current file"
                  className="h-7 w-full min-w-0 justify-start gap-1.5 px-2 text-[11px]"
                >
                  <FileCode2 aria-hidden="true" className="size-3 shrink-0" />
                  <span className="min-w-0 truncate">Ask about file</span>
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        variant="outline"
                        disabled
                        title="Ask about current file"
                        className="h-7 w-full min-w-0 justify-start gap-1.5 px-2 text-[11px]"
                      >
                        <FileCode2 aria-hidden="true" className="size-3 shrink-0" />
                        <span className="min-w-0 truncate">Ask about file</span>
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>No file open</TooltipContent>
                </Tooltip>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={summarizeContext}
                className="h-7 min-w-0 justify-start gap-1.5 px-2 text-[11px]"
              >
                <ListTree aria-hidden="true" className="size-3 shrink-0" />
                <span className="min-w-0 truncate">Summarize</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => setSection("search")}
                className="h-7 min-w-0 justify-start gap-1.5 px-2 text-[11px]"
              >
                <Search aria-hidden="true" className="size-3 shrink-0" />
                <span className="min-w-0 truncate">Search code</span>
              </Button>
            </div>

            {/* Typed extension points — NOT implemented modes. */}
            <div className="flex flex-wrap items-center gap-1 pt-1" aria-label="Reserved modes">
              {RESERVED_MODES.map((mode) => (
                <ReservedModeChip key={mode} label={mode} />
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Rename dialog (Escape closes via Radix default) */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent className="max-w-sm p-4">
          <DialogHeader>
            <DialogTitle className="text-sm">Rename conversation</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitRename();
              }
            }}
            aria-label="Conversation title"
            placeholder="Conversation title"
            className="h-8 text-xs"
          />
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRenameTarget(null)}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={submitRename}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation (Escape closes via Radix default) */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              {deleteTarget
                ? `"${deleteTarget.title ?? "Untitled conversation"}" and its ${deleteTarget.messages.length} message(s) will be permanently removed. This cannot be undone.`
                : "This conversation will be permanently removed. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
