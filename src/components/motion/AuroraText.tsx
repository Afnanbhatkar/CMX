"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AURORA_GRADIENT } from "@/lib/design-tokens";
import type { ReactNode } from "react";

export interface AuroraTextProps {
  children: ReactNode;
  /**
   * Speed multiplier. 1 matches the reference timing (8s per cycle).
   * Higher is faster.
   */
  speed?: number;
  /** Gradient stops; defaults to the exact supplied reference gradient. */
  colors?: readonly string[];
  className?: string;
  /** Very subtle glow behind the glyphs. */
  glow?: boolean;
  forceReducedMotion?: boolean;
}

/**
 * AuroraText — native React reconstruction of the supplied HTML/CSS reference.
 *
 * Reference characteristics preserved:
 * - dark background context, clipped multicolor gradient text
 * - background-size ≈ 300% 100%
 * - animated background-position 0% → 100% → 0%
 * - subtle hue rotation 0deg → 12deg → -8deg
 * - very subtle glow
 *
 * Implementation animates the same properties via Framer Motion instead of a
 * global CSS keyframe, so the component is fully self-contained (no global CSS
 * pollution) and independently replaceable.
 */
export function AuroraText({
  children,
  speed = 1,
  colors = AURORA_GRADIENT,
  className,
  glow = true,
  forceReducedMotion = false,
}: AuroraTextProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced) || forceReducedMotion;

  const style = {
    backgroundImage: `linear-gradient(90deg, ${colors.join(", ")})`,
    backgroundSize: "300% 100%",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextFillColor: "transparent",
    textShadow: glow ? "0 0 28px rgba(255, 255, 255, 0.07)" : undefined,
  } as const;

  if (reduced) {
    // Reduced motion: static gradient, no position drift, no hue rotation.
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
      initial={{ backgroundPosition: "0% 50%", filter: "hue-rotate(0deg)" }}
      animate={{
        backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
        filter: ["hue-rotate(0deg)", "hue-rotate(12deg)", "hue-rotate(-8deg)"],
      }}
      transition={{
        duration: 8 / Math.max(speed, 0.01),
        ease: "easeInOut",
        repeat: Infinity,
      }}
    >
      {children}
    </motion.span>
  );
}
