/**
 * Test-only stub for `next-auth/providers/google` (aliased in
 * vitest.config.ts) — see test/stubs/next-auth.ts for the rationale. The real
 * provider is never configured in tests; auth.ts only needs a value to put in
 * its `providers` array.
 */
export default function Google(): { id: string } {
  return { id: "google" };
}
