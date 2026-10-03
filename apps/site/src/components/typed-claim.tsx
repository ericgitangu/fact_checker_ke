import { useEffect, useRef, useState } from "react";

type TypedClaimProps = {
  text: string;
  /** Called once the full string has been "typed". */
  onDone?: () => void;
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The hero's signature moment: the sample claim types itself out, caret and
 * all, then hands off to the verdict stamp (see `.stamp-ready` in index.css).
 * This is the one orchestrated, non-interactive motion sequence on the page
 * (the brief's explicit ask for a "keystroke/typing moment") — it runs once
 * on mount, never loops, and is skipped entirely under
 * `prefers-reduced-motion`, where the full claim renders immediately.
 *
 * Accessibility: screen readers get the complete claim text immediately via
 * a visually-hidden node; the animated, character-by-character reveal is
 * `aria-hidden` so assistive tech never has to "wait" on the animation.
 */
export function TypedClaim({ text, onDone }: TypedClaimProps): React.JSX.Element {
  const reduced = useRef(prefersReducedMotion());
  const [shown, setShown] = useState(reduced.current ? text.length : 0);
  const doneRef = useRef(false);

  useEffect(() => {
    if (reduced.current) {
      if (!doneRef.current) {
        doneRef.current = true;
        onDone?.();
      }
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
        if (!doneRef.current) {
          doneRef.current = true;
          onDone?.();
        }
      }
    }, TICK_MS);

    return () => window.clearInterval(id);
    // `text` is static for this hero instance; intentionally run once.
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
