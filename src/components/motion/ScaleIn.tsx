"use client";

import { motion, useReducedMotion } from "framer-motion";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import type { ReactNode } from "react";

export interface ScaleInProps {
  children: ReactNode;
  /** Starting scale (0 < from <= 1). */
  from?: number;
  delay?: number;
  duration?: number;
  className?: string;
  once?: boolean;
  forceReducedMotion?: boolean;
}

/** Scale into view. Reduced motion renders content at full scale immediately. */
export function ScaleIn({
  children,
  from = 0.96,
  delay = 0,
  duration = motionDuration.base,
  className,
  once = true,
  forceReducedMotion = false,
}: ScaleInProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced) || forceReducedMotion;

  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, scale: from }}
      whileInView={{ opacity: 1, scale: 1 }}
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
