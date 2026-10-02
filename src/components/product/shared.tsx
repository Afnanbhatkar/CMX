/**
 * CodeMind X V2 — shared primitives for product preview components (Phase 1).
 *
 * These are the common visual building blocks used by every preview in
 * `src/components/product/*` so the public site speaks one visual language.
 * They are presentational only: no hooks, no global state, independently
 * replaceable.
 */
import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Honesty badge ──────────────────────────────────────────────────── */

export interface DemoBadgeProps {
  /** Badge text. Defaults to "Demo". */
  label?: string;
  className?: string;
}

/**
 * Marks illustrative/conceptual content as a demo.
 * Required by the Phase 1 spec: demo content must never be presented
 * as live product data.
 */
export function DemoBadge({ label = "Demo", className }: DemoBadgeProps) {
  return (
    <span
      title="Illustrative concept content — not live data"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-sm border border-border-subtle bg-surface-elevated px-1.5 py-0.5",
        "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
    >
      <FlaskConical className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

/* ── Preview frame ──────────────────────────────────────────────────── */

export interface PreviewFrameProps {
  /** Header title — usually a file path or panel name. */
  title: string;
  /** Optional right-aligned header node; defaults to a DemoBadge. */
  badge?: ReactNode;
  /** Hide the default demo badge entirely (for chrome-level mockups). */
  hideBadge?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/**
 * Standard bordered container for product previews: a compact header bar
 * plus a content body. Developer-tool density, subtle borders, no glass.
 */
export function PreviewFrame({
  title,
  badge,
  hideBadge = false,
  children,
  className,
  bodyClassName,
}: PreviewFrameProps) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-border bg-surface", className)}>
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-elevated/60 px-3">
        <span className="flex gap-1.5" aria-hidden="true">
          <i className="size-2 rounded-full bg-muted-foreground/25" />
          <i className="size-2 rounded-full bg-muted-foreground/25" />
          <i className="size-2 rounded-full bg-muted-foreground/25" />
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{title}</span>
        <span className="ml-auto flex items-center">{hideBadge ? null : (badge ?? <DemoBadge />)}</span>
      </header>
      <div className={cn("relative", bodyClassName)}>{children}</div>
    </div>
  );
}

/* ── Status dot ─────────────────────────────────────────────────────── */

export type StatusTone = "success" | "warning" | "danger" | "info" | "primary" | "muted";

const TONE_BG: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  primary: "bg-primary",
  muted: "bg-muted-foreground/40",
};

export interface StatusDotProps {
  tone: StatusTone;
  /** Gentle pulse; automatically disabled under prefers-reduced-motion. */
  pulse?: boolean;
  className?: string;
}

export function StatusDot({ tone, pulse = false, className }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        TONE_BG[tone],
        pulse && "animate-pulse motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/* ── Code syntax palette ────────────────────────────────────────────── */

/**
 * Warm technical syntax palette shared by every code visual.
 * Keys map to token classes produced by the lightweight tokenizer in
 * CodePreview / ProductPreview. Values are plain CSS colors so they also
 * work inside SVG and inline styles.
 */
export const CODE_PALETTE = {
  plain: "#d6d1c8",
  keyword: "#d98e4a",
  type: "#ffc857",
  string: "#9dbf7a",
  number: "#d08770",
  comment: "#6f675c",
  fn: "#e8c07a",
  punctuation: "#8a8378",
  property: "#c8b7a6",
} as const;

export type CodeTokenKind = keyof typeof CODE_PALETTE;
