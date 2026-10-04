"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MenuIcon, XIcon } from "@fact-checker-ke/brand";

/**
 * Primary header navigation with a responsive mobile disclosure.
 *
 * The desktop nav (Submit / Feed / Methodology / Maandamano + the locale
 * switcher) was overflowing the 375px viewport, pushing
 * every page into horizontal scroll (diagnosed at /methodology:
 * scrollWidth 568 vs clientWidth 375). On mobile it now collapses behind a
 * hamburger disclosure; on >=640px it renders as the inline row it always
 * was (the toggle is CSS-hidden there). Keyboard-operable: the toggle is a
 * real <button> with aria-expanded + aria-controls, Escape closes the
 * panel, and focus is visible via the global :focus-visible ring.
 *
 * The links + locale switcher are passed in as `children` (server-rendered
 * in AppHeader, with their next-intl labels) so this client boundary only
 * owns the open/close state, not the content.
 */
export function PrimaryNav({
  children,
  menuLabel,
}: {
  children: React.ReactNode;
  menuLabel: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const navRef = useRef<HTMLElement | null>(null);

  // Close on Escape and on a click outside the nav — standard disclosure
  // affordances so the panel never traps focus or lingers.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent): void {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onClick);
    };
  }, [open]);

  return (
    <nav className="nav-links" aria-label="Primary" ref={navRef}>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={menuLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <XIcon size={22} /> : <MenuIcon size={22} />}
      </button>
      <div
        id={menuId}
        className="nav-menu"
        data-open={open ? "true" : undefined}
        // Close only when a link is activated (soft navigation keeps this
        // client boundary mounted, so the panel would otherwise stay open);
        // never on interacting with the locale <select> inside.
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        {children}
      </div>
    </nav>
  );
}
