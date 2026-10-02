"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export interface ShimmerProps {
  children?: ReactNode;
  className?: string;
  /** When false the shimmer freezes (disabled / completed state). */
  active?: boolean;
  forceReducedMotion?: boolean;
}

/**
 * Loading-state shimmer sweep. A soft highlight travels across the surface.
 * Reduced motion or `active={false}` renders a static surface — never a
 * continuously animated block of content.
 */
export function Shimmer({
  children,
  className = "",
  active = true,
  forceReducedMotion = false,
}: ShimmerProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced) || forceReducedMotion;
  const animate = active && !reduced;

  return (
    <div
      className={`relative overflow-hidden bg-muted ${className}`}
      role="status"
      aria-label={animate ? "Loading" : undefined}
    >
      {animate ? (
        <motion.div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(100deg, transparent 20%, oklch(0.94 0.004 85 / 7%) 50%, transparent 80%)",
          }}
          initial={{ x: "-100%" }}
          animate={{ x: "100%" }}
          transition={{ duration: 1.6, ease: "linear", repeat: Infinity }}
        />
      ) : null}
      {children}
    </div>
  );
}
