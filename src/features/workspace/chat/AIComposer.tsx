"use client";

/**
 * CodeMind X V2 — AI composer (Phase 8A: advanced composer + mode system).
 *
 * Real message submission against the chat store + assistant run hook.
 *
 * Phase 8A contract implemented here:
 * - Four REAL modes (Search / Code / Agent / Loop) selected through a
 *   segmented control integrated INTO the text input (not four dashboard
 *   cards) and serialized on every request (typed backend contract).
 * - Multiline input; send / stop / cancel / regenerate.
 * - Attachments render BELOW the text field; repository-file attachments
 *   come from the REAL workspace tree and open through the shared
 *   EditorNavigationService (FileReferenceChip) — a filename that cannot
 *   resolve is never displayed.
 * - Context selection (repository / branch / current file) with honest
 *   empty states; selected code arrives via the editor's selection actions.
 * - Model selection through the LLM Gateway catalog (GET /api/llm/models) —
 *   the composer NEVER imports a provider SDK and no provider name is
 *   hardcoded in UI code; the picker renders what the gateway reports.
 * - Keyboard-first: Enter send, Shift+Enter newline, Alt+1..4 mode,
 *   Alt+M cycle mode, Escape stops a running completion.
 * - Usable at 360px without horizontal overflow.
 *
 * Non-goals respected (8B/8C/later): activity rendering stays the two honest
 * system steps; no approval UI; no autonomous loop; no response renderer.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Braces,
  Check,
  ChevronsUpDown,
  Code2,
  FileCode2,
  Layers,
  Loader2,
  Paperclip,
  Repeat,
  RotateCcw,
  Search,
  SendHorizontal,
  Square,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

import { selectActiveConversation, useWorkspaceStore } from "@/stores/workspace-store";
import { selectLedger, useContextInspectorStore } from "@/stores/context-inspector-store";
import type { Attachment } from "@/features/workspace/types";
import { SELECTION_ACTION_PROMPTS } from "@/features/workspace/types";
import type { ComposerMode } from "@/features/workspace/assistant/contracts";
import { useRepositoryMeta } from "@/features/workspace/use-repository-meta";
import { FileReferenceChip } from "@/features/workspace/components/FileReferenceChip";
import type { RepoTreeNode } from "@/features/workspace/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAssistantRun } from "./use-assistant-run";
import { useChatUiStore } from "./chat-ui-store";

const MAX_TEXTAREA_HEIGHT_PX = 160; // max-h-40
/** Max file rows rendered in the attach-file search (keeps DOM bounded). */
const MAX_FILE_RESULTS = 80;
/** Attach-file tree cache lifetime (ms) — mirrors the palette's behavior. */
const FILES_TTL_MS = 60_000;

interface ModeDescriptor {
  id: ComposerMode;
  label: string;
  icon: LucideIcon;
  /** One-line honest contract (tooltip). */
  description: string;
}

const MODES: ModeDescriptor[] = [
  {
    id: "search",
    label: "Search",
    icon: Search,
    description: "Query / retrieval task — ask about the repository.",
  },
  {
    id: "code",
    label: "Code",
    icon: Code2,
    description: "Propose an implementation or change (nothing is written).",
  },
  {
    id: "agent",
    label: "Agent",
    icon: Workflow,
    description: "Controlled multi-step plan — single-turn until the execution engine lands.",
  },
  {
    id: "loop",
    label: "Loop",
    icon: Repeat,
    description: "Autonomous controlled loop — not connected yet; runs single-turn and says so.",
  },
];

const MODE_ORDER: ComposerMode[] = MODES.map((m) => m.id);

function newAttachmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function flattenFiles(nodes: RepoTreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "file") {
      out.push(node.path);
    } else if (Array.isArray(node.children) && node.children.length > 0) {
      flattenFiles(node.children, out);
    }
  }
  return out;
}

/** Parse "path:12-34" selection labels for range navigation (best-effort). */
function parseSelectionLabel(
  label: string,
  path: string,
): { line: number; endLine: number } | null {
  if (!label.startsWith(`${path}:`)) return null;
  const match = /^:(\d+)-(\d+)$/.exec(label.slice(path.length));
  if (!match) return null;
  const line = Number(match[1]);
  const endLine = Number(match[2]);
  if (!Number.isFinite(line) || !Number.isFinite(endLine) || endLine < line) return null;
  return { line, endLine };
}

/* ------------------------------------------------------------------ */
/* Mode segmented control — integrated into the input surface          */
/* ------------------------------------------------------------------ */

function ModeSegmented({
  mode,
  onChange,
}: {
  mode: ComposerMode;
  onChange: (mode: ComposerMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Composer mode"
      className="flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-border-subtle bg-surface p-0.5"
    >
      {MODES.map((descriptor) => {
        const active = descriptor.id === mode;
        return (
          <Tooltip key={descriptor.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${descriptor.label} mode`}
                onClick={() => onChange(descriptor.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <descriptor.icon aria-hidden="true" className="size-3" />
                <span>{descriptor.label}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-56">
              <p className="font-medium">{descriptor.label}</p>
              <p className="text-[11px] text-muted-foreground">{descriptor.description}</p>
              <p className="mt-1 text-[10px] text-muted-foreground/70">
                Alt+{MODE_ORDER.indexOf(descriptor.id) + 1}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Attachment chip row (below the text field)                          */
/* ------------------------------------------------------------------ */

function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1 px-0.5">
      {attachments.map((attachment) => {
        const isFile = attachment.kind === "file" && Boolean(attachment.path);
        const selectionRange =
          attachment.kind === "selection" && attachment.path
            ? parseSelectionLabel(attachment.label, attachment.path)
            : null;
        return (
          <span
            key={attachment.id}
            className="group/chip inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-full border border-border-subtle bg-surface-elevated py-0.5 pl-1 pr-0.5"
          >
            {isFile ? (
              <FileReferenceChip
                path={attachment.path!}
                source="chat"
                size="sm"
                className="max-w-[220px] border-0 bg-transparent hover:bg-transparent"
              />
            ) : selectionRange ? (
              <FileReferenceChip
                path={attachment.path!}
                line={selectionRange.line}
                endLine={selectionRange.endLine}
                source="chat"
                size="sm"
                className="max-w-[220px] border-0 bg-transparent hover:bg-transparent"
              />
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1 py-0.5 pl-1 text-[10px] text-muted-foreground">
                <Braces aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate font-mono">{attachment.label}</span>
              </span>
            )}
            <button
              type="button"
              aria-label={`Remove attachment ${attachment.label}`}
              onClick={() => onRemove(attachment.id)}
              className="shrink-0 rounded-full p-0.5 text-muted-foreground/70 transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The composer                                                        */
/* ------------------------------------------------------------------ */

export function AIComposer() {
  const draft = useChatUiStore((s) => s.draft);
  const setDraft = useChatUiStore((s) => s.setDraft);
  const mode = useChatUiStore((s) => s.mode);
  const setMode = useChatUiStore((s) => s.setMode);
  const model = useChatUiStore((s) => s.model);
  const setModel = useChatUiStore((s) => s.setModel);
  const attachFileNonce = useChatUiStore((s) => s.attachFileNonce);

  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const composerFocusNonce = useWorkspaceStore((s) => s.composerFocusNonce);
  const newConversation = useWorkspaceStore((s) => s.newConversation);
  const queuedChatFile = useWorkspaceStore((s) => s.queuedChatFile);
  const consumeQueuedChatFile = useWorkspaceStore((s) => s.consumeQueuedChatFile);
  const queuedChatSelection = useWorkspaceStore((s) => s.queuedChatSelection);
  const consumeQueuedChatSelection = useWorkspaceStore((s) => s.consumeQueuedChatSelection);
  const lastIsAssistant = useWorkspaceStore((s) => {
    const conversation = selectActiveConversation(s);
    const messages = conversation?.messages ?? [];
    return messages.length > 0 && messages[messages.length - 1].role === "assistant";
  });

  const { meta } = useRepositoryMeta();
  const { send, stop, regenerate, isGenerating } = useAssistantRun();

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [openPopover, setOpenPopover] = useState<"attach" | "context" | "model" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastFocusNonceRef = useRef(composerFocusNonce);
  const lastAttachNonceRef = useRef(attachFileNonce);

  /* Context-selection toggles (all real: default to what actually exists). */
  const [includeRepository, setIncludeRepository] = useState(true);
  const [includeBranch, setIncludeBranch] = useState(true);
  const [includeCurrentFile, setIncludeCurrentFile] = useState(true);

  /* Sidebar quick actions bump the nonce → focus + select the draft. */
  useEffect(() => {
    if (composerFocusNonce === lastFocusNonceRef.current) return;
    lastFocusNonceRef.current = composerFocusNonce;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [composerFocusNonce]);

  /* Palette "attach a repository file" request → open the attach picker.
     Yields a microtask first so no state update happens synchronously inside
     the effect body (react-hooks/set-state-in-effect). */
  useEffect(() => {
    if (attachFileNonce === lastAttachNonceRef.current) return;
    lastAttachNonceRef.current = attachFileNonce;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) setOpenPopover("attach");
    })();
    return () => {
      cancelled = true;
    };
  }, [attachFileNonce]);

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

  /* Selected-code AI actions (editor toolbar) queue a real selection → the
     EXACT selected text becomes the AI request context, embedded in the
     draft message; a selection attachment records the location. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const queued = consumeQueuedChatSelection();
      if (!queued) return;
      const actionMeta = SELECTION_ACTION_PROMPTS[queued.action];
      const location = `${queued.path}:${queued.startLine}-${queued.endLine}`;
      const fence = "```";
      const langTag = queued.language ?? "";
      const prompt = actionMeta.prompt
        ? `${actionMeta.prompt}\n\n`
        : "Regarding this selection:\n\n";
      const message = `${prompt}File: ${location}\n${fence}${langTag}\n${queued.code}\n${fence}`;
      setDraft(message);
      setAttachments((prev) =>
        prev.some((a) => a.label === location)
          ? prev
          : [
              ...prev,
              {
                id: newAttachmentId(),
                kind: "selection" as const,
                label: location,
                path: queued.path,
              },
            ],
      );
      const el = textareaRef.current;
      if (el) el.focus();
    })();
    return () => {
      cancelled = true;
    };
  }, [queuedChatSelection, consumeQueuedChatSelection, setDraft]);

  /* Auto-resize (rows=1 → grows with content, capped at max-h-40). */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }, [draft]);

  /**
   * True only when an assistant run is actually in flight in the ACTIVE
   * conversation (the global run-phase mirror). Keeps the global Escape
   * handler from hijacking Escape inside unrelated surfaces (dialogs use
   * it to close and must keep working when nothing is generating).
   */
  const activeGenerating = useCallback((): boolean => {
    const state = useWorkspaceStore.getState();
    if (state.runPhase === "thinking") return true;
    const conversation = state.conversations.find(
      (c) => c.id === state.activeConversationId,
    );
    return conversation?.status === "generating";
  }, []);

  /* Keyboard-first mode switching (works even when the textarea is not
     focused): Alt+1..4 picks a mode, Alt+M cycles. Escape cancels a running
     completion from anywhere in the workspace. Ignored when Ctrl/Meta or
     Shift are held so system/browser shortcuts keep working. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (activeGenerating()) {
          event.preventDefault();
          stop();
        }
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const digit = /^Digit([1-4])$/.exec(event.code);
      if (digit) {
        const index = Number(digit[1]) - 1;
        const target = MODE_ORDER[index];
        if (target) {
          event.preventDefault();
          setMode(target);
        }
        return;
      }
      if (event.code === "KeyM") {
        event.preventDefault();
        const current = MODE_ORDER.indexOf(useChatUiStore.getState().mode);
        const next = MODE_ORDER[(current + 1) % MODE_ORDER.length]!;
        setMode(next);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setMode, stop, activeGenerating]);

  const contextRepository = meta?.repository.name ?? null;
  const contextBranch = meta?.repository.branch ?? null;
  const contextCurrentFile = activeTabPath ?? null;

  // 8C: the user's Context Inspector ledger travels with every run so the
  // backend can enforce pin/remove/memory-disable decisions.
  const ledger = useContextInspectorStore((s) => selectLedger(s, activeConversationId));

  const submit = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || isGenerating) return;
    const conversationId = activeConversationId ?? newConversation();
    send(conversationId, trimmed, attachments, {
      mode,
      model,
      context: {
        repository: includeRepository ? contextRepository : null,
        branch: includeBranch ? contextBranch : null,
        currentFile: includeCurrentFile ? contextCurrentFile : null,
        // Selected code reaches the run through the editor's selection
        // actions (embedded above); no live selection tracker is faked here.
        selectedCode: null,
      },
      ledger: {
        excludedRefs: [...ledger.removedRefs.map((r) => r.ref)],
        excludedMemoryIds: [...ledger.disabledMemoryIds],
        pinnedRefs: [...ledger.pinnedRefs],
      },
    });
    setDraft("");
    setAttachments([]);
  }, [
    draft,
    isGenerating,
    activeConversationId,
    newConversation,
    send,
    attachments,
    mode,
    model,
    includeRepository,
    includeBranch,
    includeCurrentFile,
    contextRepository,
    contextBranch,
    contextCurrentFile,
    ledger,
    setDraft,
  ]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape" && isGenerating) {
        event.preventDefault();
        stop();
        return;
      }
      if (event.key !== "Enter" || event.shiftKey) return;
      if (event.nativeEvent.isComposing) return; // IME composition (e.g. Hindi input)
      event.preventDefault();
      submit();
    },
    [submit, stop, isGenerating],
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
  }, [activeTabPath]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const canSend = draft.trim().length > 0 && !isGenerating;

  return (
    <div className="shrink-0 border-t border-border-subtle bg-surface p-2">
      <div className="rounded-lg border border-border-subtle bg-surface-elevated p-1.5 transition-shadow focus-within:ring-1 focus-within:ring-primary/50">
        {/* Mode system — integrated into the input surface (8A §1). */}
        <div className="mb-1 flex min-w-0 items-center gap-1 px-0.5">
          <ModeSegmented mode={mode} onChange={setMode} />
        </div>

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

        {/* Attachments appear BELOW the text field (8A §3). */}
        <AttachmentChips attachments={attachments} onRemove={removeAttachment} />

        <div className="mt-1 flex flex-wrap items-center gap-1 px-0.5 pb-0.5">
          {/* Attach (real files only) */}
          <AttachMenu
            open={openPopover === "attach"}
            onOpenChange={(open) => setOpenPopover(open ? "attach" : null)}
            activeTabPath={activeTabPath}
            onAttachActiveFile={addActiveFile}
            onAttachFile={(path) =>
              setAttachments((prev) =>
                prev.some((a) => a.path === path)
                  ? prev
                  : [
                      ...prev,
                      {
                        id: newAttachmentId(),
                        kind: "file" as const,
                        label: path,
                        path,
                      },
                    ],
              )
            }
          />

          {/* Context selection */}
          <ContextMenuPopover
            open={openPopover === "context"}
            onOpenChange={(open) => setOpenPopover(open ? "context" : null)}
            repository={contextRepository}
            branch={contextBranch}
            currentFile={contextCurrentFile}
            includeRepository={includeRepository}
            includeBranch={includeBranch}
            includeCurrentFile={includeCurrentFile}
            onIncludeRepository={setIncludeRepository}
            onIncludeBranch={setIncludeBranch}
            onIncludeCurrentFile={setIncludeCurrentFile}
          />

          {/* Model selection through the LLM Gateway */}
          <ModelPickerPopover
            open={openPopover === "model"}
            onOpenChange={(open) => setOpenPopover(open ? "model" : null)}
            model={model}
            onModelChange={setModel}
          />

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
                <TooltipContent>
                  Stop the run — marks it stopped (Esc works too)
                </TooltipContent>
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

      {/* Keyboard hints (desktop only — keeps 360px clean). */}
      <p className="hidden px-1 pt-1 text-[10px] text-muted-foreground/60 sm:block">
        Enter to send · Shift+Enter newline · Alt+1–4 mode · Alt+M cycle · Esc stop
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Attach menu — current file + REAL workspace file search             */
/* ------------------------------------------------------------------ */

function AttachMenu({
  open,
  onOpenChange,
  activeTabPath,
  onAttachActiveFile,
  onAttachFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTabPath: string | null;
  onAttachActiveFile: () => void;
  onAttachFile: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const cacheRef = useRef<{ files: string[] | null; at: number }>({ files: null, at: 0 });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      await Promise.resolve();
      if (cancelled) return;
      const cached = cacheRef.current;
      if (cached.files && Date.now() - cached.at < FILES_TTL_MS) {
        setFiles(cached.files);
        setStatus("ready");
        return;
      }
      setStatus("loading");
      try {
        const res = await fetch("/api/repository/tree", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; tree?: RepoTreeNode[] }
          | null;
        const list = data?.ok && Array.isArray(data.tree) ? flattenFiles(data.tree) : null;
        if (cancelled) return;
        if (list === null) {
          setStatus("error");
          return;
        }
        cacheRef.current = { files: list, at: Date.now() };
        setFiles(list);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open]);

  const results = useMemo(() => {
    if (!files) return [];
    const q = query.trim().toLowerCase();
    const matches = q
      ? files.filter((path) => path.toLowerCase().includes(q))
      : files;
    return matches.slice(0, MAX_FILE_RESULTS);
  }, [files, query]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
        <TooltipContent>Attach files / context</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-72 p-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!activeTabPath}
                onClick={() => {
                  onAttachActiveFile();
                  onOpenChange(false);
                }}
                className="h-7 w-full justify-start gap-2 text-[11px]"
              >
                <FileCode2 aria-hidden="true" className="size-3.5" />
                Attach current file
              </Button>
            </span>
          </TooltipTrigger>
          {!activeTabPath && <TooltipContent>No file open</TooltipContent>}
        </Tooltip>

        <div className="my-1 border-t border-border-subtle" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search repository files…"
          aria-label="Search repository files to attach"
          className="mb-1 h-7 w-full rounded-md border border-border-subtle bg-surface px-2 text-[11px] outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-primary/50"
        />
        <div className="max-h-56 overflow-y-auto">
          {status === "loading" && (
            <p className="flex items-center gap-1.5 px-1 py-2 text-[11px] text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
              Loading files…
            </p>
          )}
          {status === "error" && (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">
              File tree unavailable right now.
            </p>
          )}
          {status === "ready" && results.length === 0 && (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">No files match.</p>
          )}
          {results.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => {
                onAttachFile(path);
                onOpenChange(false);
              }}
              className="flex w-full items-center gap-1.5 rounded-[4px] px-1.5 py-1 text-left font-mono text-[11px] text-foreground/90 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <FileCode2 aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{path}</span>
            </button>
          ))}
        </div>
        <p className="px-1 pt-1 text-[10px] text-muted-foreground/60">
          Only real workspace files are listed; clicking an attached chip opens it in the editor.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Context selection popover                                           */
/* ------------------------------------------------------------------ */

function ContextMenuPopover({
  open,
  onOpenChange,
  repository,
  branch,
  currentFile,
  includeRepository,
  includeBranch,
  includeCurrentFile,
  onIncludeRepository,
  onIncludeBranch,
  onIncludeCurrentFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repository: string | null;
  branch: string | null;
  currentFile: string | null;
  includeRepository: boolean;
  includeBranch: boolean;
  includeCurrentFile: boolean;
  onIncludeRepository: (v: boolean) => void;
  onIncludeBranch: (v: boolean) => void;
  onIncludeCurrentFile: (v: boolean) => void;
}) {
  const activeCount =
    (repository && includeRepository ? 1 : 0) +
    (branch && includeBranch ? 1 : 0) +
    (currentFile && includeCurrentFile ? 1 : 0);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Select context"
              className="size-7 rounded-[6px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              <span className="relative">
                <Layers aria-hidden="true" className="size-3.5" />
                {activeCount > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 size-1.5 rounded-full bg-primary"
                  />
                ) : null}
              </span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Select context for the run</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-72 space-y-1 p-2">
        <p className="px-0.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Context sent with the run
        </p>
        <ContextRow
          label="Repository"
          value={repository}
          included={includeRepository}
          onIncluded={onIncludeRepository}
        />
        <ContextRow
          label="Branch"
          value={branch}
          included={includeBranch}
          onIncluded={onIncludeBranch}
        />
        <ContextRow
          label="Current file"
          value={currentFile}
          included={includeCurrentFile}
          onIncluded={onIncludeCurrentFile}
        />
        <div className="flex items-center justify-between gap-2 px-0.5 py-1">
          <span className="text-[11px] text-muted-foreground">Selected code</span>
          <span className="text-[11px] text-muted-foreground/70">—</span>
        </div>
        <p className="px-0.5 pt-1 text-[10px] text-muted-foreground/60">
          Attach a selection with the editor&apos;s selection actions (Ask AI / Explain).
        </p>
      </PopoverContent>
    </Popover>
  );
}

function ContextRow({
  label,
  value,
  included,
  onIncluded,
}: {
  label: string;
  value: string | null;
  included: boolean;
  onIncluded: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-0.5 py-1">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      {value ? (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-mono text-[11px] text-foreground/90" title={value}>
            {value}
          </span>
          <Switch
            checked={included}
            onCheckedChange={onIncluded}
            aria-label={`Include ${label.toLowerCase()} context`}
            className="scale-90"
          />
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground/70">—</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Model picker — renders the LLM Gateway's REAL catalog               */
/* ------------------------------------------------------------------ */

interface GatewayCatalogModel {
  id: string;
  label: string;
  available: boolean;
  servedModel: string | null;
  note: string | null;
}

function ModelPickerPopover({
  open,
  onOpenChange,
  model,
  onModelChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: string | null;
  onModelChange: (id: string | null) => void;
}) {
  const [catalog, setCatalog] = useState<{
    status: "loading" | "ready" | "error";
    models: GatewayCatalogModel[];
    provider: string | null;
  }>({ status: "loading", models: [], provider: null });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setCatalog((s) => (s.status === "ready" ? s : { status: "loading", models: [], provider: null }));
      try {
        const res = await fetch("/api/llm/models", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; provider?: string; models?: GatewayCatalogModel[] }
          | null;
        if (cancelled) return;
        if (!res.ok || !data?.ok || !Array.isArray(data.models)) {
          setCatalog({ status: "error", models: [], provider: null });
          return;
        }
        setCatalog({
          status: "ready",
          models: data.models,
          provider: typeof data.provider === "string" ? data.provider : null,
        });
      } catch {
        if (!cancelled) setCatalog({ status: "error", models: [], provider: null });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selected = catalog.models.find((m) => m.id === model) ?? null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Select model through the LLM Gateway"
              className="h-7 gap-1 rounded-[6px] px-2 text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              <ChevronsUpDown aria-hidden="true" className="size-3" />
              <span className="max-w-28 truncate">
                {selected ? selected.label : "Gateway default"}
              </span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Model (via LLM Gateway)</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80 p-2">
        <p className="px-0.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          LLM Gateway models
        </p>
        {catalog.status === "loading" && (
          <p className="flex items-center gap-1.5 px-0.5 py-2 text-[11px] text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            Loading catalog…
          </p>
        )}
        {catalog.status === "error" && (
          <p className="px-0.5 py-2 text-[11px] text-muted-foreground">
            The LLM Gateway catalog is unavailable right now.
          </p>
        )}
        {catalog.status === "ready" &&
          catalog.models.map((entry) => {
            const active = (model ?? null) === (entry.available ? entry.id : null);
            return (
              <button
                key={entry.id}
                type="button"
                disabled={!entry.available}
                onClick={() => {
                  onModelChange(entry.available ? entry.id : null);
                  onOpenChange(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2 rounded-[4px] px-1.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  entry.available && "hover:bg-surface-hover",
                  !entry.available && "cursor-not-allowed opacity-60",
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {active ? (
                    <Check aria-hidden="true" className="size-3.5 text-primary" />
                  ) : (
                    <span className="block size-3.5" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] text-foreground/90">{entry.label}</span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    {entry.id}
                    {entry.servedModel ? ` → serves ${entry.servedModel}` : ""}
                  </span>
                  {entry.note ? (
                    <span className="mt-0.5 block text-[10px] text-muted-foreground/80">
                      {entry.note}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        {catalog.provider ? (
          <p className="px-0.5 pt-1 text-[10px] text-muted-foreground/60">
            Routed through the {catalog.provider} gateway — no provider SDK in UI code.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
