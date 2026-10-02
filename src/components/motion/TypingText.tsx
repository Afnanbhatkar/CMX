"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

export interface TypingTextProps {
  text: string;
  /** Characters per second. */
  charsPerSecond?: number;
  /** Seconds before typing starts. */
  startDelay?: number;
  /** Restart after finishing. */
  loop?: boolean;
  /** Seconds to hold the full text before restarting (loop mode). */
  loopPause?: number;
  /** Show a blinking caret. */
  caret?: boolean;
  className?: string;
  onComplete?: () => void;
  forceReducedMotion?: boolean;
}

/**
 * Terminal-style typing reveal. Reduced motion shows the full text instantly
 * (derived, not stateful). All timers are cleaned up deterministically on
 * unmount and dependency change.
 */
export function TypingText({
  text,
  charsPerSecond = 28,
  startDelay = 0,
  loop = false,
  loopPause = 2.4,
  caret = true,
  className,
  onComplete,
  forceReducedMotion = false,
}: TypingTextProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced) || forceReducedMotion;
  const [count, setCount] = useState(0);
  const timers = useRef<number[]>([]);

  // Derived display value: reduced motion never needs a state update.
  const shown = reduced ? text.length : Math.min(count, text.length);

  useEffect(() => {
    if (reduced) return; // nothing to animate; `shown` already covers it

    let cancelled = false;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];

    const interval = 1000 / Math.max(charsPerSecond, 1);

    const typeAll = () => {
      for (let i = 1; i <= text.length; i++) {
        const target = i;
        const handle = window.setTimeout(() => {
          if (cancelled) return;
          setCount(target);
          if (target === text.length) onComplete?.();
        }, startDelay * 1000 + i * interval);
        timers.current.push(handle);
      }
    };

    if (loop) {
      const runCycle = () => {
        typeAll();
        const cycle =
          (startDelay + text.length / Math.max(charsPerSecond, 1) + loopPause) * 1000;
        const handle = window.setTimeout(() => {
          if (!cancelled) runCycle();
        }, cycle);
        timers.current.push(handle);
      };
      runCycle();
    } else {
      typeAll();
    }

    return () => {
      cancelled = true;
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [text, charsPerSecond, startDelay, loop, loopPause, reduced, onComplete]);

  return (
    <span className={className} aria-label={text} role="text">
      <span aria-hidden>{text.slice(0, shown)}</span>
      {caret ? (
        <span aria-hidden className="ml-0.5 inline-block w-[2px] animate-pulse bg-primary align-text-bottom [height:1em]" />
      ) : null}
    </span>
  );
}
