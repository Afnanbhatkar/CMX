"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import type { ReactNode } from "react";

export interface ActivityTransitionProps<T> {
  items: readonly T[];
  /** Stable key for each item (activity event id). */
  getKey: (item: T) => string;
  render: (item: T) => ReactNode;
  className?: string;
  forceReducedMotion?: boolean;
}

/**
 * Enter/exit transitions for live activity streams (thinking traces, agent
 * steps). Items animate in when appended and out when removed; existing rows
 * reflow smoothly via layout animation. Rendered as a semantic list.
 */
export function ActivityTransition<T>({
  items,
  getKey,
  render,
  className,
  forceReducedMotion = false,
}: ActivityTransitionProps<T>) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced) || forceReducedMotion;

  return (
    <ul className={className} aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.li
            key={getKey(item)}
            layout={!reduced}
            initial={reduced ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
            transition={{
              duration: reduced ? 0 : motionDuration.base,
              ease: motionEase.outSoft,
            }}
            className="list-none"
          >
            {render(item)}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
