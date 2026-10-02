"use client";

import { motion, useReducedMotion } from "framer-motion";
import { motionDuration, motionEase } from "@/lib/design-tokens";

export interface TextRevealProps {
  children: string;
  /** Seconds between word starts. */
  stagger?: number;
  className?: string;
  once?: boolean;
  forceReducedMotion?: boolean;
}

/**
 * Word-by-word rise-and-fade reveal. Words are clipped by their own line box,
 * so the reveal never causes layout shift or horizontal overflow.
 * Reduced motion renders the full text immediately.
 */
export function TextReveal({
  children,
  stagger = 0.06,
  className,
  once = true,
  forceReducedMotion = false,
}: TextRevealProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced) || forceReducedMotion;
  const words = children.split(/\s+/).filter(Boolean);

  if (reduced) {
    return <span className={className}>{children}</span>;
  }

  return (
    <motion.span
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, amount: 0.4 }}
      transition={{ staggerChildren: stagger }}
      aria-label={children}
    >
      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          aria-hidden
          className="inline-block overflow-hidden align-bottom"
        >
          <motion.span
            className="inline-block"
            variants={{
              hidden: { y: "110%", opacity: 0 },
              visible: {
                y: "0%",
                opacity: 1,
                transition: { duration: motionDuration.slow, ease: motionEase.outSoft },
              },
            }}
          >
            {word}
            {i < words.length - 1 ? "\u00A0" : ""}
          </motion.span>
        </span>
      ))}
    </motion.span>
  );
}

/** Convenience alias for revealing ReactNode-free strings with markup-free API. */
export function TextRevealHeading(props: Omit<TextRevealProps, "children"> & { text: string }) {
  const { text, ...rest } = props;
  return <TextReveal {...rest}>{text}</TextReveal>;
}
