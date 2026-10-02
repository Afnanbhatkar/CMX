import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionShellProps {
  /** Anchor id for navbar links (must exist — no dead links). */
  id: string;
  /** Mono uppercase category label above the title. */
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  /** Small honesty note under the description (e.g. demo-data note). */
  note?: ReactNode;
  children: ReactNode;
  /** Flush section — no vertical padding (hero handles its own). */
  flush?: boolean;
  className?: string;
  containerClassName?: string;
}

/**
 * Shared section layout for the public site: anchor target, eyebrow,
 * title, description and a bounded content container.
 */
export function SectionShell({
  id,
  eyebrow,
  title,
  description,
  note,
  children,
  flush = false,
  className,
  containerClassName,
}: SectionShellProps) {
  return (
    <section
      id={id}
      className={cn("relative scroll-mt-20", !flush && "py-16 sm:py-24", className)}
    >
      <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", containerClassName)}>
        <header className="max-w-2xl">
          <p className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-primary">
            <span aria-hidden="true" className="inline-block h-px w-6 bg-primary/50" />
            {eyebrow}
          </p>
          <h2 className="mt-3 text-balance text-2xl font-medium tracking-tight text-foreground sm:text-3xl md:text-4xl">
            {title}
          </h2>
          {description ? (
            <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
              {description}
            </p>
          ) : null}
          {note ? (
            <p className="mt-2 text-[11px] text-muted-foreground/70">{note}</p>
          ) : null}
        </header>
        <div className="mt-8 sm:mt-10">{children}</div>
      </div>
    </section>
  );
}
