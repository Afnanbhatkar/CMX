"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X, type LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { motionEase, motionDuration } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

/** A single bento card definition. */
export interface BentoItem {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  /** Rich expanded content (ReactNode) shown in the modal-like card. */
  content: ReactNode;
  /** Grid span hint. Default "regular". */
  span?: "regular" | "wide" | "tall";
}

export interface ExpandableBentoGridProps {
  items: BentoItem[];
  className?: string;
}

/**
 * Attach a `mousedown` listener on `document` that fires `onOutsideClick`
 * whenever a press lands outside the referenced element. The listener is
 * only active while `enabled` is true and is always cleaned up.
 */
function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  onOutsideClick: () => void,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;

    const handleMouseDown = (event: MouseEvent) => {
      const element = ref.current;
      if (element && !element.contains(event.target as Node)) {
        onOutsideClick();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [ref, onOutsideClick, enabled]);
}

/** Tailwind classes for the optional per-item grid span hint. */
function spanClasses(span: BentoItem["span"]): string {
  switch (span) {
    case "wide":
      return "sm:col-span-2";
    case "tall":
      // Row span only applies from `sm` up; on mobile every card stacks.
      return "sm:row-span-2 sm:min-h-[240px]";
    default:
      return "";
  }
}

/**
 * Expanded panel body: icon area, title, subtitle, description and the rich
 * scrollable content provided by the consumer.
 */
function ExpandedPanelBody({
  item,
  headingId,
}: {
  item: BentoItem;
  headingId: string;
}) {
  const Icon = item.icon;

  return (
    <>
      <div className="flex items-start gap-3 pr-12">
        <span className="grid size-9 shrink-0 place-items-center rounded-sm border border-border-subtle bg-surface">
          <Icon className="size-4.5 text-primary" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 id={headingId} className="text-base font-semibold text-foreground">
            {item.title}
          </h3>
          <p className="text-[11px] text-muted-foreground">{item.subtitle}</p>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {item.description}
      </p>

      <div className="mt-4 border-t border-border-subtle pt-4 text-sm text-foreground">
        {item.content}
      </div>
    </>
  );
}

/**
 * Expandable bento grid — collapsed cards expand into a centered, scrollable
 * dialog-like panel through a framer-motion `layoutId` shared-element
 * transition.
 *
 * Interaction contract: overlay backdrop, Escape-to-close, outside-press
 * close, scroll lock while open, focus moved to the close button on open and
 * restored to the originating card on close/unmount. Under reduced motion the
 * transitions are effectively instant.
 */
export function ExpandableBentoGrid({ items, className }: ExpandableBentoGridProps) {
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const headingId = `${baseId}-heading`;

  const prefersReducedMotion = useReducedMotion();
  const reduced = Boolean(prefersReducedMotion);

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeItem = items.find((item) => item.id === activeId) ?? null;

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  /** The card button that opened the panel — focus is restored to it. */
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setActiveId(null), []);

  useOutsideClick(panelRef, close, activeItem !== null);

  // Focus management: focus the close button on open; restore focus to the
  // originating card on close or unmount.
  useEffect(() => {
    if (!activeItem) return;
    const previousTrigger = triggerRef.current;
    closeButtonRef.current?.focus();
    return () => {
      previousTrigger?.focus();
    };
  }, [activeItem]);

  // Scroll lock while the panel is open (restored on close/unmount).
  useEffect(() => {
    if (activeId === null) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activeId]);

  // Escape-to-close.
  useEffect(() => {
    if (activeId === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveId(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeId]);

  const overlayTransition = reduced
    ? { duration: 0.01 }
    : { duration: motionDuration.base, ease: motionEase.outSoft };
  const panelTransition = reduced
    ? { duration: 0.01 }
    : { duration: motionDuration.slow, ease: motionEase.outSoft };

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4",
          className,
        )}
      >
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <motion.button
              key={item.id}
              type="button"
              layoutId={`${baseId}-${item.id}`}
              aria-haspopup="dialog"
              aria-expanded={item.id === activeId}
              aria-controls={panelId}
              onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                triggerRef.current = event.currentTarget;
                setActiveId(item.id);
              }}
              className={cn(
                "h-full min-h-[150px] cursor-pointer rounded-md border border-border bg-surface p-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                spanClasses(item.span),
              )}
              transition={panelTransition}
            >
              <span className="grid size-9 place-items-center rounded-sm border border-border-subtle bg-surface-elevated">
                <Icon className="size-4.5 text-primary" aria-hidden="true" />
              </span>
              <span className="mt-3 block text-sm font-medium text-foreground">
                {item.title}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {item.subtitle}
              </span>
              <span className="mt-1 line-clamp-3 block text-xs text-muted-foreground/80">
                {item.description}
              </span>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {activeItem ? (
          <motion.div
            key="overlay"
            className="fixed inset-0 z-[400] grid place-items-center overflow-y-auto bg-black/70 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={overlayTransition}
          >
            <motion.div
              key={activeItem.id}
              ref={panelRef}
              layoutId={`${baseId}-${activeItem.id}`}
              id={panelId}
              role="dialog"
              aria-modal="true"
              aria-labelledby={headingId}
              className="relative max-h-[82vh] w-[min(92vw,42rem)] max-w-2xl overflow-y-auto rounded-md border border-border bg-surface-elevated p-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={panelTransition}
            >
              <Button
                ref={closeButtonRef}
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={close}
                className="absolute right-3 top-3"
              >
                <X className="size-4.5" aria-hidden="true" />
              </Button>

              <ExpandedPanelBody item={activeItem} headingId={headingId} />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
