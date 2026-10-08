import { handlers } from "../../../../auth";

/**
 * Auth.js v5 catch-all route handler. `handlers` is `{ GET, POST }` built by
 * NextAuth() — it serves the whole /api/auth/* surface (sign-in, the Google
 * callback at /api/auth/callback/google, CSRF token, session, sign-out).
 *
 * Node runtime (the default for App Router route handlers): the sign-in
 * callback reaches Postgres via node-only `postgres`, so this must not run on
 * the Edge runtime.
 */
export const { GET, POST } = handlers;
