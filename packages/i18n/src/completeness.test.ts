import { describe, expect, it } from "vitest";
import en from "../messages/en.json" with { type: "json" };
import sw from "../messages/sw.json" with { type: "json" };

/**
 * AT-0028-1: every string under every namespace exists in both locales.
 *
 * Catalogs are arbitrarily-nested JSON objects (namespace -> ... -> leaf
 * string), matching next-intl's own convention of splitting a lookup key
 * like "nav.home" on "." and walking nested objects — NOT flat keys that
 * merely contain a literal dot character. (An earlier version of this
 * catalog used flat dotted keys, which next-intl's `t("nav.home")` could
 * never actually resolve — verified empirically via `next start` +
 * MISSING_MESSAGE errors in the server log, not assumed.) Paths are
 * tracked as string arrays (never re-joined/re-split) so traversal is
 * unambiguous regardless of depth.
 */
function flattenKeys(obj: Record<string, unknown>, path: string[] = []): string[][] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const nextPath = [...path, key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenKeys(value as Record<string, unknown>, nextPath);
    }
    return [nextPath];
  });
}

function pathToString(path: string[]): string {
  return path.join(".");
}

function readPath(catalog: Record<string, unknown>, path: string[]): unknown {
  let node: unknown = catalog;
  for (const segment of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

describe("message catalog completeness (ADR-0028 AT-0028-1)", () => {
  const enPaths = flattenKeys(en);
  const swPaths = flattenKeys(sw);
  const enKeys = new Set(enPaths.map(pathToString));
  const swKeys = new Set(swPaths.map(pathToString));

  it("has at least the baseline namespaces", () => {
    for (const ns of ["common", "check", "submit", "status", "tracker", "editorial"]) {
      expect(Object.keys(en)).toContain(ns);
      expect(Object.keys(sw)).toContain(ns);
    }
  });

  it("sw.json has no missing keys relative to en.json", () => {
    const missing = [...enKeys].filter((k) => !swKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("en.json has no missing keys relative to sw.json (no orphaned translations)", () => {
    const missing = [...swKeys].filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("every leaf value is a non-empty string", () => {
    for (const [locale, catalog, paths] of [
      ["en", en, enPaths],
      ["sw", sw, swPaths],
    ] as const) {
      for (const path of paths) {
        const node = readPath(catalog, path);
        const label = `${locale}:${pathToString(path)}`;
        expect(typeof node, label).toBe("string");
        expect((node as string).length, label).toBeGreaterThan(0);
      }
    }
  });
});
