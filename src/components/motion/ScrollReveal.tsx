"use client";

import { motion, useReducedMotion } from "framer-motion";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import type { ReactNode } from "react";

export type ScrollRevealDirection = "up" | "down" | "left" | "right" | "none";

export interface ScrollRevealProps {
  children: ReactNode;
  /** Axis the content travels from. "none" fades in without translation. */
  direction?: ScrollRevealDirection;
  /** Travel distance in px. */
  distance?: number;
  /** Seconds before the animation starts. */
  delay?: number;
  /** Seconds to complete. Defaults to the slow token. */
  duration?: number;
  /** Animate only the first time it enters the viewport. */
  once?: boolean;
  className?: string;
  /** Force the reduced-motion rendering regardless of OS preference. */
  forceReducedMotion?: boolean;
}

const OFFSETS: Record<ScrollRevealDirection, { x: number; y: number }> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  none: { x: 0, y: 0 },
};

/** Fade + translate into view on scroll. Reduced motion renders content immediately. */
export function ScrollReveal({
  children,
  direction = "up",
  distance = 24,
  delay = 0,
  duration = motionDuration.slow,
  className,
  once = true,
  forceReducedMotion = false,
}: ScrollRevealProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced) || forceReducedMotion;
  const offset = OFFSETS[direction];

  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, x: offset.x * distance, y: offset.y * distance }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once, amount: 0.2 }}
      transition={{
        duration: reduced ? 0 : duration,
        delay: reduced ? 0 : delay,
        ease: motionEase.outSoft,
      }}
    >
      {children}
    </motion.div>
  );
}
