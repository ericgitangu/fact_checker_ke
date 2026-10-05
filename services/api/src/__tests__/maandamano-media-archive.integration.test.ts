import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { AuthService } from "../lib/auth/service.js";
import { hotp } from "../lib/auth/totp.js";
import { FakePublisher } from "../lib/publisher.js";
import { setMaandamanoKillSwitch } from "../lib/maandamano.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

const connectionString = requireIntegrationDatabaseUrl();

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PIPELINE_CALLBACK_SECRET = "adr-0035-test-callback-secret";

function secretKeyFor(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function currentCodeFor(secret: string): string {
  return hotp(secretKeyFor(secret), Math.floor(Date.now() / 1000 / 30));
}
function nextStepCodeFor(secret: string): string {
  return hotp(secretKeyFor(secret), Math.floor(Date.now() / 1000 / 30) + 1);
}

/**
 * ADR-0035 (live media embeds, misinfo-checked, archive) exercised end to
 * end through the REAL Fastify app against a real Postgres. Covers
 * AT-0035-1..7 (the kill-switch arc mirrors the existing
 * maandamano-killswitch integration test, extended to the archive route).
 */
describe.skipIf(!connectionString)("ADR-0035 maandamano media + archive (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let auth: AuthService;
  let app: FastifyInstance;
  let publisher: FakePublisher;
  let adminId: string;
  let adminToken: string;
  let editorToken: string;

  async function createUserWithRole(
    role: "admin" | "editor",
    actorAdminId: string | null,
  ): Promise<{ id: string; token: string }> {
    const email = `adr0035-${role}-${randomUUID()}@example.test`;
    const password = "a-reasonably-strong-password-0035";
    const registered = await auth.register(email, password);
    if (!registered.ok) throw new Error("setup: register failed");
    const enrolled = await auth.enrollTotp(registered.value.id);
    if (!enrolled.ok) throw new Error("setup: enroll failed");
    const verified = await auth.verifyTotpEnrollment(registered.value.id, currentCodeFor(enrolled.value.secret));
    if (!verified.ok) throw new Error("setup: verify failed");

    let grant;
    if (role === "admin") {
      // An existing admin (shared DB from a prior run) grants admin to the
      // new user; otherwise bootstrap self-grant (no admin exists yet).
      const [existingAdmin] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.role, "admin"))
        .limit(1);
      grant = existingAdmin
        ? await auth.grantRole({ id: existingAdmin.id, role: "admin" }, registered.value.id, "admin")
        : await auth.grantRole({ id: registered.value.id, role: null }, registered.value.id, "admin");
    } else {
      // editor: granted by a known admin actor.
      grant = await auth.grantRole({ id: actorAdminId!, role: "admin" }, registered.value.id, role);
    }
    if (!grant.ok) throw new Error(`setup: ${role} grant failed: ${grant.error.message}`);

    const login = await auth.login(email, password, nextStepCodeFor(enrolled.value.secret));
    if (!login.ok) throw new Error("setup: login failed");
    return { id: registered.value.id, token: login.value.token };
  }

  async function newDemo(status: typeof schema.demonstrations.$inferSelect["status"]): Promise<string> {
    const [row] = await db
      .insert(schema.demonstrations)
      .values({
        title: `ADR-0035 advisory ${randomUUID()}`,
        area: "Test Ward",
        county: "Nairobi",
        status,
        summary: "An advisory used by the ADR-0035 integration suite.",
      })
      .returning();
    return row!.id;
  }

  beforeAll(async () => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
    auth = new AuthService(db);
    publisher = new FakePublisher();

    const admin = await createUserWithRole("admin", null);
    adminId = admin.id;
    adminToken = admin.token;
    const editor = await createUserWithRole("editor", adminId);
    editorToken = editor.token;

    await setMaandamanoKillSwitch(db, { actorId: adminId, enabled: false });

    app = await buildApp({
      config: {
        databaseUrl: connectionString as string,
        corsOrigins: ["http://localhost:3000"],
        upstashRedisRestUrl: null,
        upstashRedisRestToken: null,
        isProduction: false,
        qstashToken: null,
        analyzeHopUrl: "http://localhost:8000/internal/analyze",
        qstashCurrentSigningKey: null,
        qstashNextSigningKey: null,
        capabilityTokenSecret: "test-capability-secret",
        redisTcpUrl: null,
        webBaseUrl: null,
        revalidateSecret: null,
        pipelineCallbackSecret: PIPELINE_CALLBACK_SECRET,
      },
      publisher,
      logger: false,
    });
  });

  afterAll(async () => {
    await setMaandamanoKillSwitch(db, { actorId: adminId, enabled: false });
    await app.close();
    await close();
  });

  it("AT-0035-1: GET /v1/maandamano returns each advisory with a media array (default [])", async () => {
    const demoId = await newDemo("ongoing");
    const res = await app.inject({ method: "GET", url: "/v1/maandamano" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const found = body.demonstrations.find((d: { id: string }) => d.id === demoId);
    expect(found).toBeDefined();
    expect(found.media).toEqual([]);
  });

  it("AT-0035-2: attaching an embed stores a pointer (no bytes); a non-allowlisted host is rejected", async () => {
    const demoId = await newDemo("ongoing");

    const bad = await app.inject({
      method: "POST",
      url: `/v1/admin/maandamano/${demoId}/media`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { platform: "youtube", embedUrl: "https://cdn.evil.example/our-bucket/clip.mp4" },
    });
    expect(bad.statusCode).toBe(400);

    const good = await app.inject({
      method: "POST",
      url: `/v1/admin/maandamano/${demoId}/media`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: {
        platform: "youtube",
        embedUrl: "https://www.youtube.com/embed/abc123",
        caption: "Observed during the march",
        observedAt: "2026-10-05T08:00:00.000Z",
      },
    });
    expect(good.statusCode).toBe(201);

    // Stored shape: a pointer + metadata, never bytes. Assert at the DB row.
    const [row] = await db
      .select()
      .from(schema.demonstrationMedia)
      .where(eq(schema.demonstrationMedia.demonstrationId, demoId));
    expect(row).toBeDefined();
    expect(row!.embedUrl).toBe("https://www.youtube.com/embed/abc123");
    expect(row!.platform).toBe("youtube");
    expect(row!.misinfoStatus).toBe("unchecked");
    expect(Object.keys(row!)).not.toContain("mediaBytes");

    // Surfaced on the advisory read path.
    const get = await app.inject({ method: "GET", url: "/v1/maandamano" });
    const found = get.json().demonstrations.find((d: { id: string }) => d.id === demoId);
    expect(found.media).toHaveLength(1);
    expect(found.media[0].embedUrl).toBe("https://www.youtube.com/embed/abc123");
  });

  it("AT-0035-3: every attached embed is routed through the misinfo check; an earlier copy flags it", async () => {
    const demoId = await newDemo("ongoing");
    const before = publisher.published.length;

    const attach = await app.inject({
      method: "POST",
      url: `/v1/admin/maandamano/${demoId}/media`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { platform: "tiktok", embedUrl: "https://www.tiktok.com/embed/v2/7", caption: null },
    });
    expect(attach.statusCode).toBe(201);
    const mediaId = attach.json().media.id as string;

    // The attach enqueued a misinfo-triage job to the pipeline (every embed
    // is routed through the check).
    const jobs = publisher.published.slice(before);
    const job = jobs.find((j) => (j.body as { media_id?: string }).media_id === mediaId);
    expect(job).toBeDefined();
    expect(job!.url).toContain("/hops/media-triage");

    // The pipeline's write-back (secret-gated) flips it to flagged with a
    // recycled-footage note surfaced on the advisory.
    const callback = await app.inject({
      method: "POST",
      url: `/v1/internal/maandamano/media/${mediaId}/misinfo`,
      headers: { "x-internal-secret": PIPELINE_CALLBACK_SECRET },
      payload: {
        status: "flagged",
        note: "earlier copy seen https://example.com/old 2019-01-01 — consistent with recycled/miscontextualized footage",
        earlierUrl: "https://example.com/old",
      },
    });
    expect(callback.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: "/v1/maandamano" });
    const found = get.json().demonstrations.find((d: { id: string }) => d.id === demoId);
    expect(found.media[0].misinfoStatus).toBe("flagged");
    expect(found.media[0].misinfoNote).toContain("recycled/miscontextualized");
  });

  it("AT-0035-3: the misinfo callback rejects a request with a wrong/absent secret", async () => {
    const demoId = await newDemo("ongoing");
    const attach = await app.inject({
      method: "POST",
      url: `/v1/admin/maandamano/${demoId}/media`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { platform: "x", embedUrl: "https://x.com/i/status/1" },
    });
    const mediaId = attach.json().media.id as string;

    const noSecret = await app.inject({
      method: "POST",
      url: `/v1/internal/maandamano/media/${mediaId}/misinfo`,
      payload: { status: "clear" },
    });
    expect(noSecret.statusCode).toBe(401);

    const wrongSecret = await app.inject({
      method: "POST",
      url: `/v1/internal/maandamano/media/${mediaId}/misinfo`,
      headers: { "x-internal-secret": "wrong" },
      payload: { status: "clear" },
    });
    expect(wrongSecret.statusCode).toBe(401);
  });

  it("AT-0035-6: attaching is admin/editor-gated (unauthenticated is rejected)", async () => {
    const demoId = await newDemo("ongoing");
    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/maandamano/${demoId}/media`,
      payload: { platform: "youtube", embedUrl: "https://www.youtube.com/embed/x" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("AT-0035-7: a status change appends a status-history row in the same transaction as the status update", async () => {
    const demoId = await newDemo("ongoing");
    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/maandamano/${demoId}/status`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { status: "ended", note: "march concluded peacefully" },
    });
    expect(res.statusCode).toBe(200);

    const [demo] = await db.select().from(schema.demonstrations).where(eq(schema.demonstrations.id, demoId));
    expect(demo!.status).toBe("ended");

    const events = await db
      .select()
      .from(schema.demonstrationStatusEvents)
      .where(eq(schema.demonstrationStatusEvents.demonstrationId, demoId));
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("ended");
    expect(events[0]!.note).toBe("march concluded peacefully");
    expect(events[0]!.changedBy).toBeTruthy();

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.targetType, "demonstration"), eq(schema.auditLog.targetId, demoId)));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("AT-0035-5: the archive returns ended/cancelled advisories with status history + links, excluding live ones", async () => {
    const endedId = await newDemo("ongoing");
    const ongoingId = await newDemo("ongoing");

    // Attach an embed to the ended advisory so we can confirm the archive
    // carries embed LINKS, never raw media.
    const attach = await app.inject({
      method: "POST",
      url: `/v1/admin/maandamano/${endedId}/media`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { platform: "youtube", embedUrl: "https://www.youtube.com/embed/ended-clip" },
    });
    expect(attach.statusCode).toBe(201);

    // Conclude it (appends a status-history row).
    await app.inject({
      method: "POST",
      url: `/v1/admin/maandamano/${endedId}/status`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: "cancelled", note: "called off" },
    });

    const res = await app.inject({ method: "GET", url: "/v1/maandamano/archive" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.frozen).toBe(false);

    const archivedEnded = body.archived.find((d: { id: string }) => d.id === endedId);
    expect(archivedEnded).toBeDefined();
    expect(archivedEnded.status).toBe("cancelled");
    expect(archivedEnded.statusHistory.length).toBeGreaterThanOrEqual(1);
    expect(archivedEnded.statusHistory.some((e: { status: string }) => e.status === "cancelled")).toBe(true);
    // Embed LINKS, never raw media bytes.
    expect(archivedEnded.media[0].embedUrl).toBe("https://www.youtube.com/embed/ended-clip");

    // A still-ongoing advisory is NOT in the archive.
    expect(body.archived.some((d: { id: string }) => d.id === ongoingId)).toBe(false);
  });

  it("AT-0035-4: with the kill switch frozen, both the live list and the archive return frozen + empty without reading rows", async () => {
    const liveId = await newDemo("ongoing");
    const endedId = await newDemo("ended");

    const flip = await app.inject({
      method: "POST",
      url: "/v1/admin/maandamano/kill-switch",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: true },
    });
    expect(flip.statusCode).toBe(200);

    const live = await app.inject({ method: "GET", url: "/v1/maandamano" });
    expect(live.json().frozen).toBe(true);
    expect(live.json().demonstrations).toEqual([]);

    const archive = await app.inject({ method: "GET", url: "/v1/maandamano/archive" });
    expect(archive.json().frozen).toBe(true);
    expect(archive.json().archived).toEqual([]);

    // The rows (and media) still exist in Postgres — withheld, not deleted.
    const [stillLive] = await db.select().from(schema.demonstrations).where(eq(schema.demonstrations.id, liveId));
    expect(stillLive).toBeDefined();
    const [stillEnded] = await db.select().from(schema.demonstrations).where(eq(schema.demonstrations.id, endedId));
    expect(stillEnded).toBeDefined();

    // Unfreeze: both surfaces return again.
    await app.inject({
      method: "POST",
      url: "/v1/admin/maandamano/kill-switch",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: false },
    });
    const liveAgain = await app.inject({ method: "GET", url: "/v1/maandamano" });
    expect(liveAgain.json().frozen).toBe(false);
    expect(liveAgain.json().demonstrations.some((d: { id: string }) => d.id === liveId)).toBe(true);
  });
});
