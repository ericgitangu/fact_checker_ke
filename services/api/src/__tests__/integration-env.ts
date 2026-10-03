/**
 * ADR-0019 rule 5: "Integration tests never skip in CI. A missing DB
 * URL with CI=true is a failure." `describe.skipIf(!url)` alone (the
 * pattern used elsewhere in this directory before this change) violates
 * that rule — it silently skips in CI too if the env var is unset.
 *
 * Call this at module scope in an integration test file. It throws
 * (failing the whole file, loudly) when `CI=true` and the DB url is
 * missing; otherwise it returns the url or `null`, and the caller uses
 * `describe.skipIf(!url)` for the local-dev-convenience case only.
 */
export function requireIntegrationDatabaseUrl(envVar = "DATABASE_URL_TEST"): string | null {
  const url = process.env[envVar] ?? null;
  if (!url && process.env.CI === "true") {
    throw new Error(
      `${envVar} is required when CI=true (ADR-0019: integration tests never skip in CI, they fail loudly).`,
    );
  }
  return url;
}
