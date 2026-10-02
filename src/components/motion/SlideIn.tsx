"use client";

import { motion, useReducedMotion } from "framer-motion";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import type { ReactNode } from "react";

export type SlideDirection = "up" | "down" | "left" | "right";

export interface SlideInProps {
  children: ReactNode;
  direction?: SlideDirection;
  /** Travel distance in px. */
  distance?: number;
  delay?: number;
  duration?: number;
  className?: string;
  once?: boolean;
  forceReducedMotion?: boolean;
}

const OFFSETS: Record<SlideDirection, { x: number; y: number }> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
};

/** Slide into view from a direction. Reduced motion renders content in place. */
export function SlideIn({
  children,
  direction = "up",
  distance = 24,
  delay = 0,
  duration = motionDuration.slow,
  className,
  once = true,
  forceReducedMotion = false,
}: SlideInProps) {
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
