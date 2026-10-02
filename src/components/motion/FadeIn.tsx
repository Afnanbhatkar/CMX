"use client";

import { motion, useReducedMotion } from "framer-motion";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import type { ReactNode } from "react";

export interface FadeInProps {
  children: ReactNode;
  /** Seconds before the animation starts. */
  delay?: number;
  /** Seconds to complete. Defaults to the base token. */
  duration?: number;
  className?: string;
  /** Animate only the first time it enters the viewport. */
  once?: boolean;
  /** Force the reduced-motion rendering regardless of OS preference. */
  forceReducedMotion?: boolean;
}

/** Fade into view on scroll. Reduced motion renders content immediately. */
export function FadeIn({
  children,
  delay = 0,
  duration = motionDuration.base,
  className,
  once = true,
  forceReducedMotion = false,
}: FadeInProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced) || forceReducedMotion;

  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0 }}
      whileInView={{ opacity: 1 }}
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
