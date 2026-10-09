import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { upsertEarlyAdopter } from "./lib/early-adopters";

/**
 * Auth.js v5 (next-auth@beta) configuration for the PUBLIC site.
 *
 * SECURITY POSTURE (see also packages/db schema `early_adopters`):
 *
 * - **Stateless JWT sessions, NO database adapter.** The session is carried
 *   entirely in a signed/encrypted JWT cookie — Auth.js owns CSRF, cookie
 *   signing and the OAuth state/PKCE handshake. We do NOT attach a Drizzle
 *   adapter: public identity is intentionally not persisted as session state,
 *   and critically this keeps public logins OUT of the `users` table (the
 *   admin/editor system, which requires password_hash + role + MFA). The only
 *   thing we persist is the fire-and-forget `early_adopters` roster row.
 *
 * - **Env is read automatically by Auth.js v5**: AUTH_GOOGLE_ID /
 *   AUTH_GOOGLE_SECRET (the Google provider), AUTH_SECRET (JWT encryption) and
 *   AUTH_URL (canonical origin for the callback URL). These are set in Vercel
 *   prod; for local dev put them in apps/web/.env.local. The registered
 *   redirect URI is the standard Auth.js path:
 *   https://fact-checker-ke-web.vercel.app/api/auth/callback/google
 *
 * This module is imported by server code only (route handler, RSC header,
 * server actions, gated pages). `signIn`/`signOut` exported here are the
 * SERVER actions; client components use `next-auth/react`'s `signIn` instead
 * (no SessionProvider needed — see components/auth/sign-in-with-google.tsx).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  callbacks: {
    /**
     * Runs on every successful Google authentication, before the session JWT
     * is minted. We use it purely as the upsert seam for the early-adopters
     * roster; the upsert is fail-open internally, and we ALWAYS return `true`
     * so a roster write can never deny a login.
     */
    async signIn({ user }) {
      if (user.email) {
        await upsertEarlyAdopter({
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
          provider: "google",
        });
      }
      return true;
    },
    /**
     * Expose a stable user id on the session. With the JWT strategy the Google
     * subject lives on `token.sub`; Auth.js already puts name/email/image on
     * `session.user` from the token, so we only need to surface the id (typed
     * via types/next-auth.d.ts).
     */
    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
