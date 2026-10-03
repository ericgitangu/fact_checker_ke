import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { precacheRevision } from "./precache-revision";

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "rev-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

describe("precacheRevision", () => {
  it("is deterministic for identical content (no git, no randomness)", () => {
    const dir = fixture({ "a.tsx": "A", "b.css": "B" });
    expect(precacheRevision(["a.tsx", "b.css"], { cwd: dir, env: {} })).toBe(
      precacheRevision(["a.tsx", "b.css"], { cwd: dir, env: {} }),
    );
  });
  it("changes when any input file changes", () => {
    const one = fixture({ "a.tsx": "A", "b.css": "B" });
    const two = fixture({ "a.tsx": "A", "b.css": "B2" });
    expect(precacheRevision(["a.tsx", "b.css"], { cwd: one, env: {} })).not.toBe(
      precacheRevision(["a.tsx", "b.css"], { cwd: two, env: {} }),
    );
  });
  it("prefers an explicit APP_REVISION from the build pipeline", () => {
    const dir = fixture({ "a.tsx": "A" });
    expect(precacheRevision(["a.tsx"], { cwd: dir, env: { APP_REVISION: "abc123" } })).toBe("abc123");
  });
  it("fails loudly when an input file is missing instead of silently randomising", () => {
    const dir = fixture({});
    expect(() => precacheRevision(["missing.tsx"], { cwd: dir, env: {} })).toThrow(/missing\.tsx/);
  });
});
