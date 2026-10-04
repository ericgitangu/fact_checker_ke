import App from "./App";
import { TermsPage } from "./pages/terms";
import { PrivacyPage } from "./pages/privacy";

/**
 * Minimal, dependency-free path routing: the site is a single Vite SPA with
 * no router package installed, and /terms + /privacy only need a direct-link
 * route (ADR-0033) — not client-side navigation with history management, so
 * a full router is unwarranted. Deploy target must rewrite unknown paths to
 * index.html (SPA fallback) for a hard refresh on /terms or /privacy to
 * work; see apps/site hosting config.
 */
export function Router(): React.JSX.Element {
  switch (window.location.pathname) {
    case "/terms":
      return <TermsPage />;
    case "/privacy":
      return <PrivacyPage />;
    default:
      return <App />;
  }
}
