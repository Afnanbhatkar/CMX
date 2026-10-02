"use client";

import { motion, useReducedMotion } from "framer-motion";
import { SWEEP_GRADIENT } from "@/lib/design-tokens";
import type { ReactNode } from "react";

export interface GradientTextProps {
  children: ReactNode;
  /** Gradient stops. Defaults to the CodeMind rust→copper→amber sweep. */
  colors?: readonly string[];
  className?: string;
  /** Animate the gradient position slowly (completed-state flourish). */
  animated?: boolean;
  forceReducedMotion?: boolean;
}

/**
 * Static gradient text (the "completed" state of animated text components).
 * Optional slow position drift when `animated` is set; reduced motion keeps
 * it static. Reuses the background-clip technique with no global CSS.
 */
export function GradientText({
  children,
  colors = SWEEP_GRADIENT,
  className,
  animated = false,
  forceReducedMotion = false,
}: GradientTextProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced) || forceReducedMotion;
  const animate = animated && !reduced;

  const style = {
    backgroundImage: `linear-gradient(90deg, ${colors.join(", ")})`,
    backgroundSize: animate ? "200% 100%" : "100% 100%",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextFillColor: "transparent",
  } as const;

  if (!animate) {
    return (
      <span className={className} style={style}>
        {children}
      </span>
    );
  }

  return (
    <motion.span
      className={className}
      style={style}
      initial={{ backgroundPosition: "0% 50%" }}
      animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
      transition={{ duration: 10, ease: "linear", repeat: Infinity }}
    >
      {children}
    </motion.span>
  );
}
