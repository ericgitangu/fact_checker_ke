/**
 * Test-only stub for `next-auth/react` (aliased in vitest.config.ts) — see
 * test/stubs/next-auth.ts. The real client helper POSTs to the Auth.js route;
 * in tests the sign-in button just needs `signIn`/`signOut` to exist.
 */
export async function signIn(): Promise<void> {
  return undefined;
}

export async function signOut(): Promise<void> {
  return undefined;
}
