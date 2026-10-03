import "@testing-library/jest-dom/vitest";

// `vitest-axe` ships a `toHaveNoViolations` matcher + ambient `Vi.Assertion`
// augmentation, but that augmentation targets an older vitest typings
// shape (`Assertion<T = any>`) than this project's vitest 5.0.3 actually
// exposes (`Assertion<T, ...>`, now outside the `Vi` namespace) -- verified
// empirically via `tsc`, not assumed: the merge silently doesn't attach to
// the real `expect(...)` return type, so `toHaveNoViolations` type-checks
// as missing even though the runtime matcher would work. Every a11y test
// in this app asserts directly on `axe()`'s real `results.violations`
// (via `test/axe-config.ts`'s `expectNoAxeViolations`) instead of relying
// on that matcher, so this setup file does not register it.

// `serwist`'s internal logger is set up once, at module-evaluation time,
// from `typeof self === "undefined"` (see app/sw-offline.test.ts's
// comments) -- jsdom already defines `self` as an alias for `window`, but
// the plain "node" environment (the default for this project's non-DOM
// test files, several of which now also exercise real `serwist` strategy
// classes) does not. Setting it here, in a setupFile, runs before any
// test file's own imports are evaluated, which is early enough for
// `serwist`'s one-time module-load check to see it.
if (typeof (globalThis as { self?: unknown }).self === "undefined") {
  (globalThis as unknown as { self: typeof globalThis }).self = globalThis;
}
