import { describe, expect, it } from "vitest";
import { WEB_URL, redirectTarget } from "./redirect";

describe("apps/site redirect stub", () => {
  it("forwards the site root to the web app root", () => {
    expect(redirectTarget("/")).toBe(`${WEB_URL}/`);
  });

  it("preserves the path on a deep link", () => {
    expect(redirectTarget("/privacy")).toBe(`${WEB_URL}/privacy`);
  });

  it("preserves query and hash", () => {
    expect(redirectTarget("/", "?ref=twitter", "#waitlist")).toBe(
      `${WEB_URL}/?ref=twitter#waitlist`,
    );
  });

  it("normalises a path missing its leading slash", () => {
    expect(redirectTarget("terms")).toBe(`${WEB_URL}/terms`);
  });
});
