"use client";

/**
 * CodeMind X V2 — Context Inspector (Phase 8C §1/§2).
 *
 * Shows EXACTLY what context the AI received (the measured backend snapshot:
 * files, chunks, symbols, retrieval source + reason, honest token estimates
 * against the configured budget, memory items) and lets the user control the
 * NEXT request: pin, remove, open, replace, inspect.
 *
 * Removal honesty: a removed ref is filtered server-side — it can never
 * silently return during a request. The only way back is the user's explicit
 * Restore, which this panel shows.
 */

import { useMemo, useState } from "react";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Eye,
  FileCode2,
  FolderTree,
  GitBranch,
  Layers,
  MemoryStick,
  Pin,
  PinOff,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import type {
  ContextInspectorEntry,
  ContextInspectorSnapshot,
  ContextInspectorSource,
  MemoryRecord,
} from "@/features/workspace/assistant/contracts";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  selectLedger,
  useContextInspectorStore,
} from "@/stores/context-inspector-store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { MemoryUsedChip } from "./MemoryUsedChip";

export interface ContextInspectorProps {
  conversationId: string;
}

const SOURCE_META: Record<
  ContextInspectorSource,
  { label: string; icon: typeof FileCode2 }
> = {
  attachment: { label: "attachment", icon: FileCode2 },
  pinned: { label: "pinned", icon: Pin },
  search: { label: "retrieval", icon: Search },
  "current-file": { label: "current file", icon: FileCode2 },
  "selected-code": { label: "selection", icon: Eye },
  repository: { label: "repository", icon: FolderTree },
  branch: { label: "branch", icon: GitBranch },
  memory: { label: "memory", icon: Brain },
};

/** Refs a user can open in the editor / pin / replace are real file paths. */
function isPathRef(entry: ContextInspectorEntry): boolean {
  return (
    entry.source === "attachment" ||
    entry.source === "pinned" ||
    entry.source === "search" ||
    (entry.source === "current-file" && !entry.ref.startsWith("repo:"))
  );
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

/* ------------------------------------------------------------------ */
/* One entry row                                                       */
/* ------------------------------------------------------------------ */

function EntryRow({
  entry,
  conversationId,
  pinned,
  refreshedAt,
}: {
  entry: ContextInspectorEntry;
  conversationId: string;
  pinned: boolean;
  refreshedAt: number | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const pinRef = useContextInspectorStore((s) => s.pinRef);
  const unpinRef = useContextInspectorStore((s) => s.unpinRef);
  const removeRef = useContextInspectorStore((s) => s.removeRef);
  const touchRef = useContextInspectorStore((s) => s.touchRef);

  const meta = SOURCE_META[entry.source];
  const pathLike = isPathRef(entry);
  const Icon = meta.icon;

  const open = async () => {
    const result = await editorNavigation.openFile(entry.ref, "manual");
    if (!result.ok) {
      toast({ title: "Could not open file", description: result.message, variant: "destructive" });
    }
  };

  /** Replace = re-read the file NOW; the next run uses the fresh content. */
  const replace = async () => {
    setReplacing(true);
    try {
      const res = await fetch(`/api/repository/file?path=${encodeURIComponent(entry.ref)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        touchRef(conversationId, entry.ref);
        toast({
          title: "Re-read from disk",
          description: `${entry.ref} — the next run uses the current file state.`,
        });
      } else {
        toast({
          title: "Could not re-read",
          description: `The file service answered HTTP ${res.status}.`,
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Could not re-read",
        description: "The file service is unreachable right now.",
        variant: "destructive",
      });
    } finally {
      setReplacing(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border-subtle/80 bg-surface-elevated/60",
        !entry.included && "opacity-60",
      )}
      data-testid={`context-entry-${entry.source}`}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <button
          type="button"
          onClick={() => void open()}
          disabled={!pathLike}
          title={pathLike ? `Open ${entry.ref}` : entry.ref}
          className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-foreground/90 hover:underline disabled:no-underline disabled:opacity-80"
        >
          {entry.label}
          {entry.label !== entry.ref && (
            <span className="ml-1 text-[9px] text-muted-foreground/60">{entry.ref}</span>
          )}
        </button>
        <span className="shrink-0 rounded border border-border-subtle px-1 py-0 text-[9px] uppercase tracking-wide text-muted-foreground/80">
          {meta.label}
        </span>
        <span
          className="shrink-0 font-mono text-[9px] text-muted-foreground/70"
          title="Token estimate (chars ÷ 4) — approximate, no tokenizer connected"
        >
          ~{entry.tokenEstimate} tok
        </span>

        {/* Controls: pin / open / replace / remove (+ inspect chevron) */}
        {pathLike && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={pinned ? `Unpin ${entry.ref}` : `Pin ${entry.ref}`}
            aria-pressed={pinned}
            disabled={entry.source === "pinned" && pinned}
            onClick={() => (pinned ? unpinRef(conversationId, entry.ref) : pinRef(conversationId, entry.ref))}
            className="size-6 shrink-0 rounded-[4px] text-muted-foreground hover:text-foreground"
          >
            {pinned ? (
              <PinOff aria-hidden="true" className="size-3" />
            ) : (
              <Pin aria-hidden="true" className="size-3" />
            )}
          </Button>
        )}
        {pathLike && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Replace with current disk state: ${entry.ref}`}
            disabled={replacing}
            onClick={() => void replace()}
            className="size-6 shrink-0 rounded-[4px] text-muted-foreground hover:text-foreground"
            title="Re-read from disk — next run uses the current file state"
          >
            <RefreshCw aria-hidden="true" className={cn("size-3", replacing && "animate-spin motion-reduce:animate-none")} />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${entry.ref} from context`}
          onClick={() => removeRef(conversationId, entry.ref, meta.label)}
          title="Remove — filtered from retrieval; it will not silently return"
          className="size-6 shrink-0 rounded-[4px] text-muted-foreground hover:text-danger"
        >
          <X aria-hidden="true" className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-expanded={expanded}
          aria-label={expanded ? `Hide details for ${entry.ref}` : `Inspect ${entry.ref}`}
          onClick={() => setExpanded((v) => !v)}
          className="size-6 shrink-0 rounded-[4px] text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" className="size-3" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3" />
          )}
        </Button>
      </div>

      <p className="truncate px-2 pb-1.5 pl-7 text-[10px] leading-relaxed text-muted-foreground/80">
        {entry.included ? entry.reason : `excluded — ${entry.reason}`}
        {refreshedAt ? ` · re-read ${formatTime(refreshedAt)}` : ""}
      </p>

      {expanded && (
        <div className="space-y-1.5 border-t border-border-subtle/70 px-2.5 py-2 pl-7">
          <div>
            <p className="mb-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/80">
              Chunks
            </p>
            {entry.chunks.length === 0 ? (
              <p className="text-[10px] text-muted-foreground/75">
                none — this entry contributed no file content (path/fact only)
              </p>
            ) : (
              <ul className="space-y-0.5">
                {entry.chunks.map((chunk) => (
                  <li key={chunk.ref} className="font-mono text-[10px] text-foreground/80">
                    {chunk.included ? "✓" : "○"} {chunk.ref} — {chunk.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/80">
              Symbols
            </p>
            {entry.symbols.length === 0 ? (
              <p className="text-[10px] text-muted-foreground/75">none observed for this entry</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {entry.symbols.map((symbol) => (
                  <span
                    key={symbol}
                    className="rounded border border-border-subtle bg-background px-1 py-0 font-mono text-[9px]"
                  >
                    {symbol}
                  </span>
                ))}
              </div>
            )}
          </div>
          <p className="text-[9px] text-muted-foreground/70">
            {entry.charCount} chars · source: {meta.label} · {entry.included ? "included in the request" : "not included"}
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Removed section                                                     */
/* ------------------------------------------------------------------ */

function RemovedSection({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const removedRefs = useContextInspectorStore((s) => selectLedger(s, conversationId).removedRefs);
  const restoreRef = useContextInspectorStore((s) => s.restoreRef);

  if (removedRefs.length === 0) return null;

  return (
    <div className="rounded-lg border border-border-subtle/70 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        {open ? (
          <ChevronDown aria-hidden="true" className="size-3 text-muted-foreground" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-3 text-muted-foreground" />
        )}
        <Trash2 aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-[11px] font-medium text-muted-foreground">
          Removed ({removedRefs.length}) — filtered from retrieval
        </span>
      </button>
      {open && (
        <ul className="space-y-1 px-2 pb-2">
          {removedRefs.map((record) => (
            <li key={record.ref} className="flex items-center gap-1.5 rounded border border-border-subtle/60 px-1.5 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                {record.ref}
              </span>
              <span className="shrink-0 text-[9px] text-muted-foreground/70">{record.sourceLabel}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => restoreRef(conversationId, record.ref)}
                className="h-5 shrink-0 gap-1 px-1 text-[9px]"
                title="Explicitly re-include this ref"
              >
                <RotateCcw aria-hidden="true" className="size-2.5" />
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function ContextInspector({ conversationId }: ContextInspectorProps) {
  const [open, setOpen] = useState(false);
  const lastAssistant = useWorkspaceStore((s) => {
    const conversation = s.conversations.find((c) => c.id === conversationId);
    for (let i = (conversation?.messages.length ?? 0) - 1; i >= 0; i -= 1) {
      const m = conversation!.messages[i];
      if (m.role === "assistant" && m.contextSnapshot) return m;
    }
    return null;
  });
  const memories: MemoryRecord[] = lastAssistant?.memories ?? [];
  const memoryNote: string | null = lastAssistant?.memoryNote ?? null;

  const ledger = useContextInspectorStore((s) => selectLedger(s, conversationId));
  const disableMemory = useContextInspectorStore((s) => s.disableMemory);
  const enableMemory = useContextInspectorStore((s) => s.enableMemory);

  const snapshot: ContextInspectorSnapshot | null = lastAssistant?.contextSnapshot ?? null;

  const { includedCount, fileCount, pinnedCount } = useMemo(() => {
    if (!snapshot) return { includedCount: 0, fileCount: 0, pinnedCount: ledger.pinnedRefs.length };
    const included = snapshot.entries.filter((e) => e.included);
    return {
      includedCount: included.length,
      fileCount: included.filter((e) => isPathRef(e)).length,
      pinnedCount: ledger.pinnedRefs.length,
    };
  }, [snapshot, ledger.pinnedRefs.length]);

  const budgetPct = snapshot
    ? Math.min(100, Math.round((snapshot.charCountTotal / snapshot.budgetChars) * 100))
    : 0;

  return (
    <section
      aria-label="Context Inspector — what the AI received and controls for the next run"
      className="border-t border-border-subtle"
      data-testid="context-inspector"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-surface-hover/50"
      >
        {open ? (
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Layers aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-medium">Context Inspector</span>
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {snapshot ? (
            <>
              <span className="rounded-full border border-border-subtle px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/80">
                {fileCount} files · {includedCount} items
              </span>
              <span
                className="rounded-full border border-border-subtle px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/80"
                title="Honest estimate (chars ÷ 4) vs the configured context budget"
              >
                ~{snapshot.tokenEstimateTotal.toLocaleString()} tok · {budgetPct}% of budget
              </span>
            </>
          ) : (
            <span className="rounded-full border border-border-subtle px-1.5 py-0.5 text-[9px] text-muted-foreground/70">
              no run snapshot yet
            </span>
          )}
          {pinnedCount > 0 && (
            <span className="rounded-full border border-primary/30 px-1.5 py-0.5 font-mono text-[9px] text-primary">
              {pinnedCount} pinned
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="max-h-96 space-y-2 overflow-y-auto px-3 pb-3" data-testid="context-inspector-body">
          {!snapshot ? (
            <p className="rounded-lg border border-dashed border-border-subtle px-3 py-4 text-center text-[11px] leading-relaxed text-muted-foreground">
              No run snapshot yet — send a message and this panel shows exactly
              what the run received: files, chunks, symbols, retrieval reasons
              and the token estimate against the budget.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground/80">
                  Last run · {formatTime(snapshot.capturedAt)} · run{" "}
                  <span className="font-mono">{snapshot.runId.slice(0, 14)}</span>
                </span>
                <span className="text-[10px] text-muted-foreground/70">
                  budget {budgetPct}% ({snapshot.charCountTotal.toLocaleString()}/{snapshot.budgetChars.toLocaleString()} chars · est.)
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-border-subtle/60">
                <div
                  className="h-full rounded-full bg-primary/70 transition-[width]"
                  style={{ width: `${budgetPct}%` }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={budgetPct}
                  aria-label="Context budget used (estimated)"
                />
              </div>

              <div className="space-y-1.5">
                {snapshot.entries.map((entry) => (
                  <EntryRow
                    key={`${entry.source}:${entry.ref}`}
                    entry={entry}
                    conversationId={conversationId}
                    pinned={ledger.pinnedRefs.includes(entry.ref)}
                    refreshedAt={ledger.refreshedAt[entry.ref]}
                  />
                ))}
              </div>
            </>
          )}

          {(memories.length > 0 || memoryNote) && (
            <div className="rounded-lg border border-border-subtle/70 bg-background/40 p-2">
              <div className="mb-1 flex items-center gap-1.5">
                <MemoryStick aria-hidden="true" className="size-3.5 text-muted-foreground" />
                <span className="text-[11px] font-medium">Memory</span>
              </div>
              <MemoryUsedChip
                memories={memories}
                note={memoryNote}
                disabledIds={ledger.disabledMemoryIds}
                onToggle={(_id, enabled) =>
                  enabled
                    ? enableMemory(conversationId, _id)
                    : disableMemory(conversationId, _id)
                }
              />
            </div>
          )}

          <RemovedSection conversationId={conversationId} />

          <p className="text-[9px] leading-relaxed text-muted-foreground/60">
            Pinned files are read in full on every run. Removed refs are
            filtered out of retrieval server-side — they never silently return
            during a request; restoring one is always explicit and shown here.
          </p>
        </div>
      )}
    </section>
  );
}
