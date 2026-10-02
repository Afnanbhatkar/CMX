import { cn } from "@/lib/utils";

export interface LogoMarkProps {
  /** Show the "CodeMind X" wordmark next to the monogram. */
  withWordmark?: boolean;
  className?: string;
}

/**
 * CodeMind X brand mark — an abstract C/X lattice monogram.
 * Pure SVG, no external assets, one visual language across the site.
 */
export function LogoMark({ withWordmark = true, className }: LogoMarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        viewBox="0 0 32 32"
        className="size-7 shrink-0"
        role="img"
        aria-label="CodeMind X logo"
      >
        {/* lattice background */}
        <rect x="1" y="1" width="30" height="30" rx="6" className="fill-surface-elevated" />
        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="6"
          fill="none"
          className="stroke-border"
          strokeWidth="1.5"
        />
        {/* C — open ring */}
        <path
          d="M21.5 11.2A7 7 0 1 0 21.5 20.8"
          fill="none"
          className="stroke-primary"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        {/* X — crossing strokes (node connections) */}
        <path
          d="M11.4 21.6 20.6 10.4M11.4 10.4 20.6 21.6"
          fill="none"
          className="stroke-foreground/85"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        {/* node dots */}
        <circle cx="11.4" cy="10.4" r="1.6" className="fill-primary" />
        <circle cx="20.6" cy="21.6" r="1.6" className="fill-primary" />
      </svg>
      {withWordmark ? (
        <span className="text-[15px] font-medium tracking-tight text-foreground">
          CodeMind&nbsp;<span className="text-primary">X</span>
        </span>
      ) : null}
    </span>
  );
}
