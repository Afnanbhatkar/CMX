"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import type { ReactNode } from "react";

export interface StaggerRevealProps {
  children: ReactNode;
  /** Seconds between each child's reveal. */
  stagger?: number;
  /** Seconds before the first child starts. */
  delayChildren?: number;
  className?: string;
  /** Animate only the first time it enters the viewport. */
  once?: boolean;
  /** Force the reduced-motion rendering regardless of OS preference. */
  forceReducedMotion?: boolean;
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: motionDuration.slow, ease: motionEase.outSoft },
  },
};

/**
 * Orchestrates StaggerItem children: each reveals in sequence when the group
 * enters the viewport. Reduced motion renders the group immediately visible.
 */
export function StaggerReveal({
  children,
  stagger = 0.08,
  delayChildren = 0,
  className,
  once = true,
  forceReducedMotion = false,
}: StaggerRevealProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced) || forceReducedMotion;

  if (reduced) {
    // Reduced motion: no orchestration, children render statically visible.
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount: 0.15 }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger, delayChildren } },
      }}
    >
      {children}
    </motion.div>
  );
}

/** One staggered child. Must be nested inside a StaggerReveal (variant propagation). */
export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const prefersReduced = useReducedMotion();
  if (prefersReduced) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}
