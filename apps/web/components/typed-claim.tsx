"use client";

import { useEffect, useState } from "react";

type TypedClaimProps = {
  text: string;
  /** Called once the full string has been "typed". */
  onDone?: () => void;
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The landing hero's signature moment: the sample claim types itself out,
 * caret and all, then hands off to the verdict stamp (see `.landing-stamp`
 * / `.stamp-ready` in globals.css). Ported from the retired apps/site. Runs
 * once on mount, never loops, and is skipped entirely under
 * `prefers-reduced-motion`, where the full claim renders immediately and
 * `onDone` fires right away so the stamp still appears.
 *
 * Accessibility: screen readers get the complete claim text immediately via
 * a visually-hidden node; the animated, character-by-character reveal is
 * `aria-hidden` so assistive tech never has to "wait" on the animation.
 */
export function TypedClaim({ text, onDone }: TypedClaimProps): React.JSX.Element {
  // Lazy initialisers so the reduced-motion probe runs once at mount and the
  // value is held in state (not a ref read during render — react-hooks/refs).
  const [reduced] = useState(prefersReducedMotion);
  const [shown, setShown] = useState(() => (reduced ? text.length : 0));

  useEffect(() => {
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        onDone?.();
      }
    };

    if (reduced) {
      finish();
      return undefined;
    }

    let frame = 0;
    const CHARS_PER_TICK = 1;
    const TICK_MS = 26;
    const id = window.setInterval(() => {
      frame += CHARS_PER_TICK;
      setShown(Math.min(frame, text.length));
      if (frame >= text.length) {
        window.clearInterval(id);
        finish();
      }
    }, TICK_MS);

    return () => window.clearInterval(id);
    // `text`/`reduced` are fixed for this hero instance; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <span aria-hidden="true">
        {text.slice(0, shown)}
        {shown < text.length && <span className="type-caret" aria-hidden="true" />}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}
