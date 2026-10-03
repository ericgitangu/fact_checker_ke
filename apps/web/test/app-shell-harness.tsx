import type { ReactElement, ReactNode } from "react";
import { AppHeader, AppFooter } from "../components/site-chrome";

/**
 * Mirrors the landmark structure app/layout.tsx assembles in production
 * (skip-link -> header -> <main id="main-content"> -> footer), using the
 * REAL AppHeader/AppFooter components. Needed because @testing-library/react
 * renders with client ReactDOM, which can't resolve an async Server
 * Component passed as a nested JSX tag the way Next's RSC runtime does --
 * so this harness awaits AppHeader()/AppFooter() itself first and splices
 * in the already-resolved element trees, rather than reimplementing their
 * markup.
 */
export async function AppShellHarness({ children }: { children: ReactNode }): Promise<ReactElement> {
  const header = await AppHeader();
  const footer = await AppFooter();
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {header}
      <main id="main-content" className="app-main">
        {children}
      </main>
      {footer}
    </>
  );
}
