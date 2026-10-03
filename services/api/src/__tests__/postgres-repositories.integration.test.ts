import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresRepositories } from "../repositories/postgres.js";
import type { CheckRepository, SubmissionRepository, WaitlistRepository } from "../repositories/types.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * Exercises the real Postgres repositories (not the in-memory doubles)
 * against DATABASE_URL_TEST. Requires the schema to already be migrated
 * — locally that's the docker compose pgvector service or a Neon `dev`
 * branch; in CI it's the pgvector/pgvector:pg16 service container with
 * migrations run as a prior workflow step (.github/workflows/ci.yml).
 */
const connectionString = requireIntegrationDatabaseUrl();

describe.skipIf(!connectionString)("Postgres repositories (integration)", () => {
  let submissions: SubmissionRepository;
  let checks: CheckRepository;
  let waitlist: WaitlistRepository;
  let close: () => Promise<void>;

  beforeAll(() => {
    const repos = createPostgresRepositories(connectionString as string);
    submissions = repos.submissions;
    checks = repos.checks;
    waitlist = repos.waitlist;
    close = repos.close;
  });

  afterAll(async () => {
    await close();
  });

  describe("SubmissionRepository", () => {
    it("persists a submission and reads it back by id", async () => {
      const created = await submissions.create({
        url: "https://example.com/clip",
        text: null,
        submittedBy: "integration-test",
      });

      const found = await submissions.getById(created.id);
      expect(found.ok).toBe(true);
      if (found.ok) {
        expect(found.value.id).toBe(created.id);
        expect(found.value.url).toBe("https://example.com/clip");
        expect(found.value.status).toBe("received");
      }
    });

    it("returns a not_found RepoError for an unknown id", async () => {
      const result = await submissions.getById(randomUUID());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("not_found");
      }
    });
  });

  describe("CheckRepository", () => {
    it("returns a not_found RepoError for an unknown check id", async () => {
      const result = await checks.getById(randomUUID());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("not_found");
      }
    });
  });

  describe("WaitlistRepository", () => {
    it("is idempotent on normalised email: joined then already_joined", async () => {
      const email = `integration-${randomUUID()}@example.com`;

      const first = await waitlist.join({ email, source: "site" });
      expect(first.ok).toBe(true);
      if (first.ok) expect(first.value.status).toBe("joined");

      const second = await waitlist.join({ email, source: "web" });
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.value.status).toBe("already_joined");
    });
  });
});
