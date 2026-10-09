import "server-only";
import { getDb, schema } from "./db";

/**
 * The profile fields we persist for a public Google sign-in. Everything here
 * comes straight from the OAuth profile Auth.js already normalised onto
 * `user` — no extra scopes, no PII beyond email/display-name/avatar URL.
 */
export interface EarlyAdopterProfile {
  email: string;
  name?: string | null;
  image?: string | null;
  /** The public IdP. Defaults to 'google'; plain text (not an enum) so a
   *  second provider later is an insert value, not a schema migration. */
  provider?: string;
}

/**
 * Upsert the signed-in user into the `early_adopters` roster.
 *
 * Called from the Auth.js `signIn` callback on EVERY login (see auth.ts):
 * inserts on first sight, and on return updates name/image/last_seen_at
 * (ON CONFLICT (email)). The row is NOT a session — auth is stateless JWT —
 * it is only a record of who has adopted the product early.
 *
 * FAIL-OPEN BY CONTRACT: any failure here (missing DATABASE_URL, a Neon
 * hiccup, a transient network error) is swallowed and logged, never thrown.
 * A roster write must never be able to block a login, because the JWT is the
 * source of truth for the session and nothing in the auth path reads this
 * table back. The trade-off is explicit: a dropped write means a missing /
 * stale roster row, which has zero effect on the user's ability to sign in or
 * on any gated surface.
 */
export async function upsertEarlyAdopter(profile: EarlyAdopterProfile): Promise<void> {
  // Normalise the natural key: Google returns lowercase, but the unique index
  // is case-sensitive, so fold defensively to avoid duplicate rows.
  const email = profile.email.trim().toLowerCase();
  if (email === "") return;

  const name = profile.name ?? null;
  const image = profile.image ?? null;
  const provider = profile.provider ?? "google";

  try {
    const db = getDb();
    const now = new Date();
    await db
      .insert(schema.earlyAdopters)
      .values({ email, name, image, provider, lastSeenAt: now })
      .onConflictDoUpdate({
        target: schema.earlyAdopters.email,
        // Deliberately NOT touching created_at (first-seen is immutable) or
        // provider (a returning user keeps their original IdP of record).
        set: { name, image, lastSeenAt: now },
      });
  } catch (error) {
    console.error(
      "[early-adopters] upsert failed (fail-open, login proceeds):",
      error instanceof Error ? error.message : error,
    );
  }
}
