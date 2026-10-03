import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cache-busting revision for precached files that are not build-hashed
 * (e.g. the /~offline fallback page).
 *
 * Content-addressed: the revision versions the *content* being precached, so
 * it is deterministic across machines/containers and only changes when that
 * content changes. Deliberately does NOT use `git rev-parse` (absent in
 * Docker build contexts, and changes on unrelated commits) or a random UUID
 * (forces a re-download on every deploy).
 *
 * An explicit `APP_REVISION` from the build pipeline wins when set.
 */
export function precacheRevision(
  files: readonly string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): string {
  const env = opts.env ?? process.env;
  const explicit = env.APP_REVISION?.trim();
  if (explicit) return explicit;

  const cwd = opts.cwd ?? process.cwd();
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    let body: Buffer;
    try {
      body = readFileSync(resolve(cwd, file));
    } catch (cause) {
      throw new Error(`precacheRevision: cannot read input file "${file}"`, { cause });
    }
    hash.update(file).update("\0").update(body).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}
