import { redirectTarget } from "./redirect";

// Client fallback for the retired marketing site (see src/redirect.ts). The
// server-side 308 in vercel.json normally fires first; if a document ever
// loads here directly, forward immediately with `replace` so the stub never
// becomes a Back-button trap.
const { pathname, search, hash } = window.location;
window.location.replace(redirectTarget(pathname, search, hash));
