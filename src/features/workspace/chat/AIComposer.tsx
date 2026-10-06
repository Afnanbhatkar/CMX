"use client";

/**
 * CodeMind X V2 — AI composer (Phase 8A: advanced composer + mode system).
 *
 * Real message submission against the chat store + assistant run hook.
 *
 * Phase 8A contract implemented here:
 * - Four REAL modes (Search / Code / Agent / Loop) selected through a
 *   segmented control with a rubber-band physics thumb (stretch / squash /
 *   glide, draggable) integrated INTO the text input (not four dashboard
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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Braces,
  Check,
  ChevronsUpDown,
  Code2,
  EyeOff,
  FileCode2,
  Gauge,
  Image as ImageIcon,
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
import type { ComposerMode, AssistantCapabilities } from "@/features/workspace/assistant/contracts";
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
    description: "Real multi-agent orchestrator — plan, retrieval, analysis, verification, live in the thought chain.",
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
/* Mode segmented control — the ORIGINAL composer UI (icons + honest   */
/* tooltips + compact pills) now driven by the user's RubberSegment    */
/* spring engine: the active pill became a physics THUMB that          */
/* stretches, squashes and glides between modes. Pointer-draggable;    */
/* Alt+1..4 / Alt+M animate it too; prefers-reduced-motion snaps.      */
/* ------------------------------------------------------------------ */

/** Rubber preset "periods" — the user-provided default feel. */
const RUBBER = { stretch: 100, squash: 3, speed: 1, glide: 75 };

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function ModeSegmented({
  mode,
  onChange,
}: {
  mode: ComposerMode;
  onChange: (mode: ComposerMode) => void;
}) {
  const index = Math.max(0, MODES.findIndex((descriptor) => descriptor.id === mode));
  const idxRef = useRef(index);
  idxRef.current = index;

  /* SSR/pre-hydration: the active pill renders as a plain CSS background on
     the active button; after mount the thumb snaps into the same spot and
     takes over (same geometry — seamless swap, no flash). */
  const [thumbReady, setThumbReady] = useState(false);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const slotsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const simRef = useRef({
    L: 0, R: 0, vL: 0, vR: 0, tL: 0, tR: 0, raf: 0, last: 0,
    pending: false, drag: false, suppress: false, startX: 0, grab: 0,
  });

  const apply = () => {
    const s = simRef.current;
    const th = thumbRef.current;
    if (!th) return;
    const baseW = Math.max(1, s.tR - s.tL);
    const w = Math.max(baseW * 0.4, s.R - s.L);
    const grow = Math.max(0, w / baseW - 1);
    const H = th.offsetHeight || 1;
    const sy = 1 - (RUBBER.squash * Math.min(1.5, grow * 2.5)) / H;   // rubber squash
    th.style.width = `${w}px`;
    th.style.transform = `translateX(${s.L}px) scaleY(${sy})`;
  };

  const setTargets = (i: number) => {
    const b = slotsRef.current[i];
    if (!b) return;
    simRef.current.tL = b.offsetLeft;
    simRef.current.tR = b.offsetLeft + b.offsetWidth;
  };

  const snap = () => {
    const s = simRef.current;
    s.L = s.tL; s.R = s.tR; s.vL = s.vR = 0;
    apply();
  };

  const step = (now: number) => {
    const s = simRef.current;
    const dt = Math.min(0.05, (now - s.last) / 1000);
    s.last = now;
    const dir = Math.sign((s.tL + s.tR) / 2 - (s.L + s.R) / 2);
    const omega = 14 * RUBBER.speed;
    const zeta = 1 - 0.55 * (RUBBER.glide / 100);                 // 1 (no bounce) to 0.45 (bouncy)
    const ratio = 1 / (1 + (RUBBER.stretch / 100) * 1.4);          // trailing edge is softer: the rubber stretch
    const kL = omega * omega * (dir > 0 ? ratio : 1);
    const kR = omega * omega * (dir < 0 ? ratio : 1);
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) {
      s.vL += (kL * (s.tL - s.L) - 2 * zeta * Math.sqrt(kL) * s.vL) * h;
      s.vR += (kR * (s.tR - s.R) - 2 * zeta * Math.sqrt(kR) * s.vR) * h;
      s.L += s.vL * h;
      s.R += s.vR * h;
    }
    const settled =
      Math.abs(s.tL - s.L) < 0.05 && Math.abs(s.tR - s.R) < 0.05 && Math.abs(s.vL) < 0.05 && Math.abs(s.vR) < 0.05;
    if (settled && !s.drag) { snap(); s.raf = 0; return; }
    apply();
    s.raf = requestAnimationFrame(step);
  };

  const reducedMotion = () =>
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const kick = () => {
    const s = simRef.current;
    if (reducedMotion()) { snap(); return; }
    if (!s.raf) { s.last = performance.now(); s.raf = requestAnimationFrame(step); }
  };

  const select = (i: number) => {
    if (i < 0 || i >= MODES.length) return;
    setTargets(i);
    kick();
    if (i !== idxRef.current) {
      idxRef.current = i;
      const descriptor = MODES[i];
      if (descriptor) onChange(descriptor.id);
    }
  };

  /* Measure + keep the thumb aligned through resizes. */
  useIso(() => {
    const tr = trackRef.current;
    if (!tr) return;
    const measure = () => { setTargets(idxRef.current); snap(); };
    measure();
    setThumbReady(true);
    const ro = new ResizeObserver(measure);
    ro.observe(tr);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(simRef.current.raf);
      simRef.current.raf = 0;
    };
  }, []);

  /* External mode changes (Alt+1..4 / Alt+M) glide the thumb too. Clicks
     already set the same targets — this no-ops for them. */
  useEffect(() => {
    const s = simRef.current;
    const b = slotsRef.current[index];
    if (!b) return;
    const tL = b.offsetLeft;
    const tR = tL + b.offsetWidth;
    if (s.tL === tL && s.tR === tR) return;
    setTargets(index);
    kick();
  }, [index]);

  const nearest = (center: number) => {
    let best = 0, bd = Infinity;
    slotsRef.current.forEach((b, i) => {
      if (!b) return;
      const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - center);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    const tr = trackRef.current;
    if (e.button !== 0 || !tr) return;
    const s = simRef.current;
    const x = e.clientX - tr.getBoundingClientRect().left;
    if (x < s.L || x > s.R) return;                           // drag starts on the thumb only
    s.pending = true; s.drag = false; s.startX = e.clientX;
    s.grab = x - (s.L + s.R) / 2;
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const s = simRef.current, tr = trackRef.current;
    if (!s.pending || !tr) return;
    if (!s.drag && Math.abs(e.clientX - s.startX) > 3) {
      s.drag = true;
      tr.setPointerCapture(e.pointerId);
    }
    if (!s.drag) return;
    const first = slotsRef.current[0], last = slotsRef.current[MODES.length - 1], cur = slotsRef.current[idxRef.current];
    if (!first || !last || !cur) return;
    const w = cur.offsetWidth;
    const x = e.clientX - tr.getBoundingClientRect().left - s.grab;
    const minL = first.offsetLeft, maxR = last.offsetLeft + last.offsetWidth;
    s.tL = Math.min(Math.max(x - w / 2, minL), maxR - w);
    s.tR = s.tL + w;
    kick();
  };

  const endDrag = (e: ReactPointerEvent, cancelled: boolean) => {
    const s = simRef.current, tr = trackRef.current;
    if (!s.pending) return;
    const wasDrag = s.drag;
    s.pending = false; s.drag = false;
    if (!wasDrag) return;                                      // plain click is handled by the button
    if (tr?.hasPointerCapture(e.pointerId)) tr.releasePointerCapture(e.pointerId);
    s.suppress = true;
    setTimeout(() => { s.suppress = false; }, 0);
    select(cancelled ? idxRef.current : nearest((s.tL + s.tR) / 2));
    setTargets(idxRef.current);
    kick();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const k = e.key;
    let n = idxRef.current;
    if (k === "ArrowRight" || k === "ArrowDown") n = Math.min(MODES.length - 1, n + 1);
    else if (k === "ArrowLeft" || k === "ArrowUp") n = Math.max(0, n - 1);
    else if (k === "Home") n = 0;
    else if (k === "End") n = MODES.length - 1;
    else return;
    e.preventDefault();
    select(n);
    slotsRef.current[n]?.focus();
  };

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label="Composer mode"
      className="relative flex w-fit max-w-full select-none items-center gap-0.5 rounded-md border border-border-subtle bg-surface p-0.5"
      style={{ touchAction: "pan-y" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
      onKeyDown={onKeyDown}
    >
      {/* Rubber thumb — the previous active pill (bg-primary/15, rounded-[5px]),
          now spring-animated BEHIND the buttons (buttons are positioned + later
          in DOM, so icons/labels paint above it). */}
      <div
        ref={thumbRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0.5 left-0 w-0 rounded-[5px] bg-primary/15"
        style={{ willChange: "transform,width", transformOrigin: "center" }}
      />
      {MODES.map((descriptor, i) => {
        const active = i === index;
        return (
          <Tooltip key={descriptor.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${descriptor.label} mode`}
                ref={(el) => { slotsRef.current[i] = el; }}
                onClick={() => { if (!simRef.current.suppress) select(i); }}
                className={cn(
                  "relative flex shrink-0 items-center gap-1 rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  active
                    ? cn(!thumbReady && "bg-primary/15", "text-primary")
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
  /* Phase 9.5 — incognito run + one-click depth override (spec §13 + §9). */
  const incognito = useChatUiStore((s) => s.incognito);
  const setIncognito = useChatUiStore((s) => s.setIncognito);
  const depthOverride = useChatUiStore((s) => s.depthOverride);
  const setDepthOverride = useChatUiStore((s) => s.setDepthOverride);

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

  /* 8.5 §9: measured transport capabilities (image understanding etc.). */
  const [capabilities, setCapabilities] = useState<AssistantCapabilities | null>(null);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/assistant/capabilities", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; capabilities?: AssistantCapabilities }
          | null;
        if (!cancelled && data?.ok && data.capabilities) setCapabilities(data.capabilities);
      } catch {
        // capabilities unknown — the image button stays gated (honest default)
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

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
      memory: {
        incognito,
        depth: depthOverride ?? undefined,
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
    incognito,
    depthOverride,
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

          {/* Image attach — capability-gated (8.5 §9) */}
          <ImageAttachButton capabilities={capabilities} />

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

          {/* Phase 9.5 — incognito run toggle (spec §13): no new persistent
              memory is created from messages sent while it is on. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Incognito mode"
                aria-pressed={incognito}
                onClick={() => setIncognito(!incognito)}
                className={`size-7 rounded-[6px] ${
                  incognito
                    ? "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                }`}
              >
                <EyeOff aria-hidden="true" className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-60 text-[10.5px]">
              {incognito
                ? "Incognito ON — no new memory will be saved from your messages (reads follow your Memory preferences)."
                : "Incognito mode: run without saving new memory"}
            </TooltipContent>
          </Tooltip>

          {/* Phase 9.5 — one-click adaptive depth override (spec §9). */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Answer depth"
                onClick={() =>
                  setDepthOverride(
                    depthOverride === null
                      ? "beginner"
                      : depthOverride === "beginner"
                        ? "expert"
                        : null,
                  )
                }
                className={`size-7 rounded-[6px] ${
                  depthOverride
                    ? "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                }`}
              >
                <Gauge aria-hidden="true" className="size-3.5" />
                {depthOverride ? (
                  <span className="sr-only">Depth override: {depthOverride}</span>
                ) : null}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-60 text-[10.5px]">
              {depthOverride
                ? `Depth override for this run: ${depthOverride}. Click to return to your saved preference.`
                : "Answer depth: currently your saved preference. Click to override (beginner → expert → saved)."}
            </TooltipContent>
          </Tooltip>

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
/* Image attach — capability-gated (8.5 §9). The button renders the    */
/* MEASURED transport capability: image flows stay disabled with an    */
/* honest reason until the LLM transport can actually read images.     */
/* ------------------------------------------------------------------ */

function ImageAttachButton({ capabilities }: { capabilities: AssistantCapabilities | null }) {
  const supported = capabilities?.imageUnderstanding.supported === true;
  const reason =
    capabilities?.imageUnderstanding.reason ??
    "Checking the transport's image capability…";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Attach image"
            aria-disabled={!supported}
            disabled={!supported}
            className="size-7 rounded-[6px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <ImageIcon aria-hidden="true" className="size-3.5" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-60 text-[10.5px]">
        {supported
          ? "Attach a screenshot or image"
          : `Image understanding unavailable — ${reason}`}
      </TooltipContent>
    </Tooltip>
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
