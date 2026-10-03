import { describe, it, expect } from "vitest";
import { resolveConfig } from "../config.js";

describe("resolveConfig", () => {
  it("allows DATABASE_URL to be unset outside production", () => {
    const config = resolveConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(config.databaseUrl).toBeNull();
    expect(config.isProduction).toBe(false);
  });

  it("fails fast when DATABASE_URL is unset in production", () => {
    expect(() => resolveConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL is required/,
    );
  });

  it("parses CORS_ORIGINS as a comma list, falling back to dev defaults", () => {
    const withEnv = resolveConfig({
      NODE_ENV: "test",
      CORS_ORIGINS: "https://a.example.com, https://b.example.com",
    } as NodeJS.ProcessEnv);
    expect(withEnv.corsOrigins).toEqual(["https://a.example.com", "https://b.example.com"]);

    const withoutEnv = resolveConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(withoutEnv.corsOrigins).toEqual(["http://localhost:5173", "http://localhost:3000"]);
  });
});
