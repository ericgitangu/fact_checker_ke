"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The shared scroll-reveal primitive — the single implementation of the
 * "element steps into view once, then stays" behaviour that <TwoEngineFlow>
 * pioneered inline (see two-engine-flow.tsx's own IntersectionObserver).
 * Extracted here so every animated surface in both apps orchestrates the
 * same way instead of each re-rolling its own observer.
 *
 * Contract, deliberately conservative:
 *  - Returns a ref to attach to the element, and `revealed` (false until the
 *    element first scrolls into view, then latched true — it never toggles
 *    back off, so content doesn't flicker on scroll-out).
 *  - Reduced-motion-safe at the source: when the user asks for reduced
 *    motion, OR when IntersectionObserver is unavailable (SSR, jsdom, old
 *    engines), `revealed` starts true so the finished state renders
 *    immediately and nothing animates. CSS carries its own belt-and-braces
 *    reduced-motion block too (reveal.css), same pattern as waving-flag.css.
 *
 * `once: false` opts into re-arming (reveal out, reveal back in) for the
 * rare surface that wants it; the default (once) is what the brief's "one
 * orchestrated moment per view, not scattered jitter" calls for.
 */
export type UseRevealOptions = {
  /** Fraction of the element visible before it counts as revealed. 0–1. */
  threshold?: number;
  /** Shrink/grow the trigger box, e.g. "0px 0px -10% 0px" to fire a touch early. */
  rootMargin?: string;
  /** Latch on first reveal (default). false re-arms on every entry/exit. */
  once?: boolean;
};

export type UseRevealResult<T extends HTMLElement> = {
  ref: React.RefObject<T | null>;
  revealed: boolean;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useReveal<T extends HTMLElement = HTMLDivElement>(
  options: UseRevealOptions = {},
): UseRevealResult<T> {
  const { threshold = 0.2, rootMargin = "0px 0px -8% 0px", once = true } = options;
  const ref = useRef<T | null>(null);
  // Start hidden only when we can actually run an observer AND motion is
  // wanted; otherwise start revealed so the end state shows with no JS gate.
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            if (once) {
              observer.disconnect();
              break;
            }
          } else if (!once) {
            setRevealed(false);
          }
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return { ref, revealed };
}
