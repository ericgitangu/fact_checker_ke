/**
 * Test-only stub for `next-auth` (aliased in vitest.config.ts).
 *
 * WHY: `next-auth@beta` internally does a bare `import … from "next/server"`
 * that vitest's native ESM resolver can't resolve (it lands on the directory,
 * not `next/server.js`), so merely importing the real package breaks every
 * suite that renders the app shell (AppHeader calls `auth()`). Production is
 * unaffected — Next's own bundler resolves it fine (verified by `next build`).
 *
 * No test exercises real authentication, so this stub returns a logged-out
 * session; AppHeader then renders its signed-out ("Sign in") branch, which is
 * what the a11y/footer suites assert against.
 */
interface StubHandlers {
  GET: () => Promise<Response>;
  POST: () => Promise<Response>;
}

interface StubNextAuth {
  handlers: StubHandlers;
  auth: () => Promise<null>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export default function NextAuth(): StubNextAuth {
  return {
    handlers: {
      GET: async () => new Response(null, { status: 200 }),
      POST: async () => new Response(null, { status: 200 }),
    },
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
}
