/**
 * Test-only no-op module. Aliased in place of `server-only` (vitest.config.ts):
 * the `server-only` guard is a build-time marker with no runtime behaviour, and
 * vite's test resolver doesn't honour its export restriction, so a no-op here
 * lets server modules (lib/db.ts, lib/early-adopters.ts) load in tests. The
 * guard still does its real job in the actual Next build.
 */
export {};
