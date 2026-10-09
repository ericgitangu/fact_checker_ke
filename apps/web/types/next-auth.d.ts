import type { DefaultSession } from "next-auth";

/**
 * Augment the Auth.js session so `session.user.id` is a typed, always-present
 * string (set from the JWT `sub` in the session callback — see auth.ts). The
 * default `session.user` already carries name/email/image; this only adds id.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
