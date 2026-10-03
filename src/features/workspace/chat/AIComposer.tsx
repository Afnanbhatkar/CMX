"use client";

/**
 * CodeMind X V2 — AI composer.
 *
 * Real message submission against the chat store + assistant run hook.
 * Attachments are honest references (active file path / repository name);
 * planned capabilities (custom tool results, mode switching) are rendered as
 * disabled extension points, never as fake modes (RULES.md §9).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  FolderGit2,
  FileCode2,
  Paperclip,
  RotateCcw,
  SendHorizontal,
  Square,
  Wrench,
  X,
} from "lucide-react";

import { selectActiveConversation, useWorkspaceStore } from "@/stores/workspace-store";
import type { Attachment } from "@/features/workspace/types";
import { useRepositoryMeta } from "@/features/workspace/use-repository-meta";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAssistantRun } from "./use-assistant-run";
import { useChatUiStore } from "./chat-ui-store";

/** Reserved mode extension points — typed, NOT implemented (later phases). */
const RESERVED_MODES = ["Search", "Code", "Agent", "Loop"] as const;

const MAX_TEXTAREA_HEIGHT_PX = 160; // max-h-40

function newAttachmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ReservedModeChip({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-disabled="true"
          className="cursor-not-allowed rounded border border-border-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/60 select-none"
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>Available in a later phase</TooltipContent>
    </Tooltip>
  );
}

export function AIComposer() {
  const draft = useChatUiStore((s) => s.draft);
  const setDraft = useChatUiStore((s) => s.setDraft);

  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const composerFocusNonce = useWorkspaceStore((s) => s.composerFocusNonce);
  const newConversation = useWorkspaceStore((s) => s.newConversation);
  const queuedChatFile = useWorkspaceStore((s) => s.queuedChatFile);
  const consumeQueuedChatFile = useWorkspaceStore((s) => s.consumeQueuedChatFile);
  const lastIsAssistant = useWorkspaceStore((s) => {
    const conversation = selectActiveConversation(s);
    const messages = conversation?.messages ?? [];
    return messages.length > 0 && messages[messages.length - 1].role === "assistant";
  });

  const { meta } = useRepositoryMeta();
  const { send, stop, regenerate, isGenerating } = useAssistantRun();

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastFocusNonceRef = useRef(composerFocusNonce);

  /* Sidebar quick actions bump the nonce → focus + select the draft. */
  useEffect(() => {
    if (composerFocusNonce === lastFocusNonceRef.current) return;
    lastFocusNonceRef.current = composerFocusNonce;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [composerFocusNonce]);

  /* "Explain with AI" (file context menu) queues a file path → attach it.
     Yields a microtask first so no state update happens synchronously inside
     the effect body (react-hooks/set-state-in-effect). */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const queued = consumeQueuedChatFile();
      if (!queued) return;
      setAttachments((prev) =>
        prev.some((a) => a.path === queued)
          ? prev
          : [
              ...prev,
              {
                id: newAttachmentId(),
                kind: "file" as const,
                label: queued,
                path: queued,
              },
            ],
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [queuedChatFile, consumeQueuedChatFile]);

  /* Auto-resize (rows=1 → grows with content, capped at max-h-40). */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }, [draft]);

  const submit = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || isGenerating) return;
    const conversationId = activeConversationId ?? newConversation();
    send(conversationId, trimmed, attachments);
    setDraft("");
    setAttachments([]);
  }, [draft, isGenerating, activeConversationId, newConversation, send, attachments, setDraft]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (event.nativeEvent.isComposing) return; // IME composition (e.g. Hindi input)
      event.preventDefault();
      submit();
    },
    [submit],
  );

  const addActiveFile = useCallback(() => {
    if (!activeTabPath) return;
    setAttachments((prev) =>
      prev.some((a) => a.path === activeTabPath)
        ? prev
        : [
            ...prev,
            {
              id: newAttachmentId(),
              kind: "file" as const,
              label: activeTabPath,
              path: activeTabPath,
            },
          ],
    );
    setAttachOpen(false);
  }, [activeTabPath]);

  const addRepositoryContext = useCallback(() => {
    const name = meta?.repository.name;
    if (!name) return;
    setAttachments((prev) =>
      prev.some((a) => a.kind === "repository")
        ? prev
        : [...prev, { id: newAttachmentId(), kind: "repository" as const, label: name }],
    );
    setAttachOpen(false);
  }, [meta]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const hasRepository = Boolean(meta?.repository);
  const canSend = draft.trim().length > 0 && !isGenerating;

  return (
    <div className="shrink-0 border-t border-border-subtle bg-surface p-2">
      {attachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="inline-flex max-w-[240px] items-center gap-1 rounded-full border border-border-subtle bg-surface-elevated py-0.5 pl-2 pr-1 text-[10px] text-muted-foreground"
            >
              {attachment.kind === "repository" ? (
                <FolderGit2 aria-hidden="true" className="size-3 shrink-0" />
              ) : (
                <FileCode2 aria-hidden="true" className="size-3 shrink-0" />
              )}
              <span className="truncate font-mono">{attachment.label}</span>
              <button
                type="button"
                aria-label={`Remove attachment ${attachment.label}`}
                onClick={() => removeAttachment(attachment.id)}
                className="rounded-full p-0.5 text-muted-foreground/70 transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border-subtle bg-surface-elevated p-1.5 transition-shadow focus-within:ring-1 focus-within:ring-primary/50">
        <Textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask CodeMind X… (English / हिंदी / Hinglish)"
          aria-label="Message the assistant"
          className="max-h-40 min-h-0 resize-none border-0 bg-transparent px-2 py-1.5 text-[13px] shadow-none focus-visible:ring-0 md:text-[13px]"
        />

        <div className="mt-1 flex flex-wrap items-center gap-1 px-0.5 pb-0.5">
          {/* Attach */}
          <Popover open={attachOpen} onOpenChange={setAttachOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Attach context"
                    className="size-7 rounded-[6px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  >
                    <Paperclip aria-hidden="true" className="size-3.5" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>Attach context</TooltipContent>
            </Tooltip>
            <PopoverContent align="start" className="w-64 p-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!activeTabPath}
                      onClick={addActiveFile}
                      className="h-7 w-full justify-start gap-2 text-[11px]"
                    >
                      <FileCode2 aria-hidden="true" className="size-3.5" />
                      Attach active file
                    </Button>
                  </span>
                </TooltipTrigger>
                {!activeTabPath && <TooltipContent>No file open</TooltipContent>}
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!hasRepository}
                      onClick={addRepositoryContext}
                      className="h-7 w-full justify-start gap-2 text-[11px]"
                    >
                      <FolderGit2 aria-hidden="true" className="size-3.5" />
                      Attach repository context
                    </Button>
                  </span>
                </TooltipTrigger>
                {!hasRepository && <TooltipContent>No repository</TooltipContent>}
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled
                      className="h-7 w-full justify-start gap-2 text-[11px] text-muted-foreground"
                    >
                      <Wrench aria-hidden="true" className="size-3.5" />
                      Custom tool results — later phase
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Available in a later phase</TooltipContent>
              </Tooltip>
            </PopoverContent>
          </Popover>

          {/* Reserved mode extension points (typed, not implemented). */}
          <div className="flex items-center gap-1" aria-label="Reserved assistant modes">
            {RESERVED_MODES.map((mode) => (
              <ReservedModeChip key={mode} label={mode} />
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1">
            {lastIsAssistant && !isGenerating && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Regenerate"
                    onClick={regenerate}
                    className="size-7 rounded-[6px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  >
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Regenerate response</TooltipContent>
              </Tooltip>
            )}

            {isGenerating ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Stop generation"
                    onClick={stop}
                    className="size-7 rounded-[6px]"
                  >
                    <Square aria-hidden="true" className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Stop generation</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    aria-label="Send message"
                    disabled={!canSend}
                    onClick={submit}
                    className="size-7 rounded-[6px]"
                  >
                    <SendHorizontal aria-hidden="true" className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {draft.trim().length === 0 ? "Type a message first" : "Send message"}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
