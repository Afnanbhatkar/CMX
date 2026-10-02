"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import type { ReactNode } from "react";

export interface ParallaxProps {
  children: ReactNode;
  /** Max vertical travel in px (element drifts -speed..+speed across viewport scroll). */
  speed?: number;
  className?: string;
  /** Force the reduced-motion rendering regardless of OS preference. */
  forceReducedMotion?: boolean;
}

/**
 * Subtle scroll-linked vertical drift for hero and section decoration.
 *
 * Guarantees:
 * - Transform-only (translateY) — never top/left, so no layout thrash and no
 *   horizontal overflow is ever introduced.
 * - Reduced motion OR coarse pointer: renders as a static div, no transform.
 */
export function Parallax({
  children,
  speed = 40,
  className,
  forceReducedMotion = false,
}: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotion();
  const [coarsePointer, setCoarsePointer] = useState(false);

  // Coarse pointers (touch) get no scroll-linked movement at all.
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarsePointer(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [speed, -speed]);

  // Reduced/coarse: same element, but no motion styles — a plain static div.
  const active = !prefersReduced && !forceReducedMotion && !coarsePointer;

  return (
    <motion.div ref={ref} className={className} style={active ? { y } : undefined}>
      {children}
    </motion.div>
  );
}
