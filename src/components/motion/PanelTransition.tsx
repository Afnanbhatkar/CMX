"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { springSoft } from "@/lib/design-tokens";
import type { ReactNode } from "react";

export interface PanelTransitionProps {
  /** Whether the panel content is mounted. */
  show: boolean;
  children: ReactNode;
  className?: string;
  forceReducedMotion?: boolean;
}

/**
 * Mount/unmount transition for panels and content swaps.
 * Uses AnimatePresence for exit animations; reduced motion skips movement.
 */
export function PanelTransition({
  show,
  children,
  className,
  forceReducedMotion = false,
}: PanelTransitionProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced) || forceReducedMotion;

  return (
    <AnimatePresence initial={false} mode="wait">
      {show ? (
        <motion.div
          key="panel"
          className={className}
          initial={reduced ? false : { opacity: 0, y: 8, scale: 0.995 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.995 }}
          transition={reduced ? { duration: 0.01 } : springSoft}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
