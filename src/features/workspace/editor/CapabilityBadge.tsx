"use client";

/**
 * CodeMind X V2 — capability badge (V2.1 ADDITIONS §D).
 *
 * Renders ONE language capability with its honest engine label. The label
 * comes from CAPABILITY_SOURCE_META — components never hand-write engine
 * names, so a placeholder can never masquerade as a verified feature.
 */

import { Info } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  CAPABILITY_FEATURES,
  CAPABILITY_SOURCE_META,
  getLanguageCapabilities,
  type LanguageCapabilitySet,
} from "./language-capabilities";
import type { ParseEngine } from "./parse-worker/parse-worker-client";

const TONE_CLASS: Record<"ok" | "warn" | "off", string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  off: "border-border-subtle bg-surface-elevated/40 text-muted-foreground",
};

const FEATURE_LABELS: Record<keyof LanguageCapabilitySet, string> = {
  definitions: "Definitions",
  references: "References",
  symbols: "Symbols",
  diagnostics: "Diagnostics",
};

export function CapabilityBadge({
  feature,
  source,
  note,
  compact = false,
}: {
  feature: keyof LanguageCapabilitySet;
  source: keyof typeof CAPABILITY_SOURCE_META;
  note?: string;
  compact?: boolean;
}) {
  const meta = CAPABILITY_SOURCE_META[source];
  const explanation = note ?? meta.note;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid={`capability-badge-${feature}`}
          className={cn(
            "inline-flex shrink-0 cursor-help items-center gap-1 rounded border px-1.5 py-0 text-[10px] leading-4 font-normal select-none",
            TONE_CLASS[meta.tone],
          )}
        >
          {FEATURE_LABELS[feature]}
          {!compact ? <span aria-hidden="true">·</span> : null}
          {!compact ? meta.label : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72 text-[10.5px]">
        <span className="font-medium">{FEATURE_LABELS[feature]}: {meta.label}</span>
        <br />
        {explanation}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The full honest capability strip for a language — the one component every
 * editor/intelligence/search surface renders (single source of badges).
 */
export function CapabilityStrip({
  languageId,
  symbolEngine,
  className,
}: {
  languageId: string;
  symbolEngine: ParseEngine;
  className?: string;
}) {
  const capabilities = getLanguageCapabilities(languageId, symbolEngine);
  return (
    <div
      role="list"
      aria-label="Language capability badges"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {CAPABILITY_FEATURES.map((feature) => (
        <CapabilityBadge
          key={feature}
          feature={feature}
          source={capabilities.set[feature]}
          note={capabilities.notes[feature]}
          compact={capabilities.set[feature] === "unavailable"}
        />
      ))}
    </div>
  );
}

/** Small helper marker for surfaces that need the "why" affordance. */
export function CapabilityHint({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="note"
          className="inline-flex cursor-help items-center text-muted-foreground"
        >
          <Info aria-hidden="true" className="size-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 text-[10.5px]">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
