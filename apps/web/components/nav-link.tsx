"use client";

import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";

/**
 * A primary-nav link that knows whether it's the current route.
 *
 * The header (`AppHeader`, site-chrome.tsx) is a Server Component — it
 * doesn't know the active pathname at render time — so the active-state
 * logic lives in this small client leaf instead of hoisting the whole nav
 * to the client. `aria-current="page"` is the real signal (screen readers
 * announce it, and `.nav-links a[aria-current="page"]` in globals.css
 * carries the visual treatment); `data-active` just mirrors it for CSS
 * that wants a plain attribute selector.
 *
 * Matches exactly OR by prefix (`/checks/123` under a `/checks` link) —
 * every current nav destination (`/submit`, `/feed`, `/methodology`,
 * `/maandamano`) is a leaf route today, so this only matters once a link
 * ever points at a section root with sub-pages.
 */
export function NavLink({
  href,
  children,
  ...props
}: LinkProps & { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const hrefPath = typeof href === "string" ? href : href.pathname ?? "";
  const isActive = pathname === hrefPath || (hrefPath !== "/" && pathname.startsWith(`${hrefPath}/`));

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      data-active={isActive ? "true" : undefined}
      {...props}
    >
      {children}
    </Link>
  );
}
