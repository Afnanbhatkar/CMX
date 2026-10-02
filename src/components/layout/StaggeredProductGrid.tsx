"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A single staggered-grid cell. The grid renders `node` inside a bordered wrapper. */
export interface StaggeredGridItem {
  id: string;
  node: ReactNode;
}

export interface StaggeredProductGridProps {
  items: StaggeredGridItem[];
  className?: string;
}

/** Number of offset columns on `md` and up (collapses to one column below). */
const COLUMN_COUNT = 3;

/**
 * Column vertical offsets (offset composition): the middle column sits
 * lowest, the last column slightly raised. Applied at every breakpoint.
 */
const COLUMN_OFFSET_CLASSES: Record<number, string> = {
  1: "mt-10 lg:mt-16",
  2: "mt-4 lg:mt-8",
};

/**
 * Staggered product grid — items are distributed round-robin into three
 * offset columns that reveal with a stagger as they enter the viewport and
 * drift with a subtle scroll-scrubbed parallax.
 *
 * Implementation notes:
 * - GSAP + ScrollTrigger are dynamically imported so they stay out of the
 *   initial bundle and never run during SSR.
 * - Content is never pre-hidden in CSS: GSAP hides cells right before
 *   animating, so if JS/GSAP fails (or reduced motion is set) the grid simply
 *   renders fully visible and static.
 * - All triggers/inline styles are reverted on unmount via `gsap.context()`.
 */
export function StaggeredProductGrid({ items, className }: StaggeredProductGridProps) {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  /** Key of the last bound item set — avoids re-binding GSAP on parent re-renders. */
  const boundKeyRef = useRef<string | null>(null);

  // Round-robin column assignment: col = i % 3. Columns stack as plain blocks
  // when the container collapses to `grid-cols-1` below `md`.
  const columns: StaggeredGridItem[][] = Array.from(
    { length: COLUMN_COUNT },
    () => [],
  );
  items.forEach((item, index) => {
    columns[index % COLUMN_COUNT].push(item);
  });

  // Stable dependency for the animation effect: only re-run when the item set
  // actually changes, not on every parent render.
  const itemKey = items.map((item) => item.id).join("\n");

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;

    // Reduced motion: skip ALL GSAP work; the grid stays fully visible.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    // The effect cleanup resets the bound key, so a StrictMode double-invoke
    // re-binds correctly while identical re-renders are skipped.
    if (boundKeyRef.current === itemKey) return;
    boundKeyRef.current = itemKey;

    let cancelled = false;
    // Structural type — avoids depending on GSAP's ambient namespace.
    let context: { revert: () => void } | null = null;

    (async () => {
      try {
        const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
          import("gsap"),
          import("gsap/ScrollTrigger"),
        ]);

        if (cancelled || !scopeRef.current) return;
        gsap.registerPlugin(ScrollTrigger);

        context = gsap.context(() => {
          const cells = scope.querySelectorAll<HTMLElement>("[data-stagger-item]");
          const columns = scope.querySelectorAll<HTMLElement>("[data-stagger-col]");

          // Hidden here (not via CSS) immediately before animating — content
          // can never end up invisible if GSAP never loads.
          gsap.fromTo(
            cells,
            { autoAlpha: 0, y: 32 },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.7,
              ease: "power3.out",
              stagger: 0.08,
              scrollTrigger: { trigger: scope, start: "top 78%", once: true },
            },
          );

          // Subtle scrub parallax: middle column drifts up, others down.
          columns.forEach((column, index) => {
            gsap.to(column, {
              yPercent: index === 1 ? -3 : 3,
              ease: "none",
              scrollTrigger: {
                trigger: scope,
                start: "top bottom",
                end: "bottom top",
                scrub: 0.6,
              },
            });
          });
        }, scope);
      } catch (error) {
        // GSAP failed to load — surface it; the grid remains visible/static.
        console.warn(
          "[StaggeredProductGrid] GSAP unavailable — rendering static grid.",
          error,
        );
      }
    })();

    return () => {
      cancelled = true;
      boundKeyRef.current = null;
      context?.revert();
    };
  }, [itemKey]);

  if (items.length === 0) return null;

  return (
    <div
      ref={scopeRef}
      className={cn("grid grid-cols-1 gap-3 md:grid-cols-3", className)}
    >
      {columns.map((columnItems, columnIndex) => (
        <div
          key={`column-${columnIndex}`}
          data-stagger-col
          className={cn(
            "flex min-w-0 flex-col gap-3",
            COLUMN_OFFSET_CLASSES[columnIndex],
          )}
        >
          {columnItems.map((item) => (
            <div
              key={item.id}
              data-stagger-item
              className="overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-primary/40"
            >
              {item.node}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
