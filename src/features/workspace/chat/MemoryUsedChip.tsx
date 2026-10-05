"use client";

/**
 * CodeMind X V2 — MemoryUsedChip (Phase 8C §3).
 *
 * "Memory used: N" — clicking reveals exactly what was retrieved: memory
 * type (tier), content, scope, source, confidence and evidence. Each memory
 * can be disabled for the request: disabled ids are sent with the run and
 * the backend filters them BEFORE anything reaches the model.
 */

import { useState } from "react";
import { Brain, ChevronDown, ChevronUp, Eye } from "lucide-react";

import type { MemoryRecord } from "@/features/workspace/assistant/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface MemoryUsedChipProps {
  memories: MemoryRecord[];
  note: string | null;
  disabledIds: string[];
  onToggle: (memoryId: string, enabled: boolean) => void;
}

const TIER_LABEL: Record<MemoryRecord["tier"], string> = {
  "saved-explicit-memory": "saved explicit memory",
  "inferred-memory": "inferred memory",
};

const CONFIDENCE_CLASS: Record<MemoryRecord["confidence"], string> = {
  high: "border-success/40 text-success",
  medium: "border-warning/40 text-warning",
  low: "border-border-subtle text-muted-foreground",
};

export function MemoryUsedChip({ memories, note, disabledIds, onToggle }: MemoryUsedChipProps) {
  const enabledCount = memories.filter((m) => !disabledIds.includes(m.id)).length;
  /* 8.5 §10: "Memory used: Project Rules, Authentication Decision" — the
     label names WHAT was used when it is short enough to be readable. */
  const enabledMemories = memories.filter((m) => !disabledIds.includes(m.id));
  const labelMemories = enabledMemories.slice(0, 2).map((m) => m.scope ?? m.id);
  const chipLabel =
    labelMemories.length > 0
      ? `Memory used: ${labelMemories.join(", ")}${enabledMemories.length > 2 ? ` +${enabledMemories.length - 2}` : ""}`
      : `Memory used: ${enabledCount}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="memory-used-chip"
          className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-1.5 py-0.5 text-[9px] text-muted-foreground/80 transition-colors hover:border-primary/40 hover:text-foreground"
          title="Show the project memory this run used"
        >
          <Brain aria-hidden="true" className="size-3 shrink-0" />
          {chipLabel}
          <Eye aria-hidden="true" className="size-2.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[340px] max-w-[calc(100vw-2rem)] p-3"
        data-testid="memory-used-popover"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium">Project memory used</span>
          <span className="text-[10px] text-muted-foreground">
            {enabledCount} of {memories.length} enabled
          </span>
        </div>

        {memories.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {note ?? "No memory was used for this run."}
          </p>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {memories.map((memory) => {
              const enabled = !disabledIds.includes(memory.id);
              return (
                <div
                  key={memory.id}
                  className={cn(
                    "rounded-lg border border-border-subtle bg-background/60 p-2 transition-opacity",
                    !enabled && "opacity-50",
                  )}
                  data-testid={`memory-item-${memory.id}`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <Badge
                        variant="outline"
                        className="shrink-0 border-border-subtle px-1 py-0 text-[9px] uppercase tracking-wide"
                      >
                        {TIER_LABEL[memory.tier]}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn("shrink-0 px-1 py-0 text-[9px]", CONFIDENCE_CLASS[memory.confidence])}
                      >
                        {memory.confidence} confidence
                      </Badge>
                      {memory.scope && (
                        <span className="truncate font-mono text-[9px] text-muted-foreground/80">
                          {memory.scope}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-[9px] text-muted-foreground/70">use</span>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(v) => onToggle(memory.id, v)}
                        aria-label={`${enabled ? "Disable" : "Enable"} memory ${memory.scope ?? memory.id}`}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-foreground/85">{memory.content}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground/75">
                    <span>source: {memory.source}</span>
                    {memory.evidence && (
                      <span className="font-mono">evidence: {memory.evidence}</span>
                    )}
                    {memory.matchedTerms.length > 0 && (
                      <span>matched: {memory.matchedTerms.slice(0, 4).join(", ")}</span>
                    )}
                  </div>
                  {!enabled && (
                    <p className="mt-1 text-[9px] text-warning">
                      Disabled — excluded from the next run of this conversation.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-2 border-t border-border-subtle pt-1.5 text-[9px] leading-relaxed text-muted-foreground/70">
          Tier 3 evidence — memory never overrides repository code or your current instruction.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** Collapsible wrapper used where vertical space is tight (inspector panel). */
export function MemoryUsedDisclosure({ memories, note, disabledIds, onToggle }: MemoryUsedChipProps) {
  const [open, setOpen] = useState(false);
  const enabledMemories = memories.filter((m) => !disabledIds.includes(m.id));
  const labelMemories = enabledMemories.slice(0, 2).map((m) => m.scope ?? m.id);
  const chipLabel =
    labelMemories.length > 0
      ? `Memory used: ${labelMemories.join(", ")}${enabledMemories.length > 2 ? ` +${enabledMemories.length - 2}` : ""}`
      : `Memory used: ${enabledMemories.length}`;

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
      >
        <Brain aria-hidden="true" className="size-3" />
        {chipLabel}
        {open ? (
          <ChevronUp aria-hidden="true" className="size-3" />
        ) : (
          <ChevronDown aria-hidden="true" className="size-3" />
        )}
      </Button>
      {open && (
        <MemoryUsedChip memories={memories} note={note} disabledIds={disabledIds} onToggle={onToggle} />
      )}
    </div>
  );
}
