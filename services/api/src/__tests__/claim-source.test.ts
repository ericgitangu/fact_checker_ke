import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  InMemoryClaimSourceStore,
  submitClaimSource,
  resolveUrlServerSide,
  type ReverifyPayload,
} from "../lib/claim-source.js";
import { FakePublisher } from "../lib/publisher.js";
import { tierForUrl, isAuthoritativeTier } from "../lib/credibility-registry.js";

const REVERIFY_URL = "http://pipeline.local/hops/verify";

function deps(publisher: FakePublisher, reverifyThreshold = 2) {
  return {
    // Identity resolver: the submitted URL is its own resolved URL (no network
    // in unit tests). The resolution path itself is covered separately below.
    resolveUrl: async (url: string) => url,
    publisher,
    reverifyHopUrl: REVERIFY_URL,
    reverifyThreshold,
  };
}

function openCheck(store: InMemoryClaimSourceStore, claimText = "The budget was 100B."): string {
  const id = randomUUID();
  store.seedCheck(id, {
    lifecycleState: "awaiting_sources",
    claimText,
    submissionId: randomUUID(),
    orgId: randomUUID(),
  });
  return id;
}

describe("tierForUrl (vendored credibility registry)", () => {
  it("tiers registered primary + established-media hosts, and subdomains", () => {
    expect(tierForUrl("https://knbs.or.ke/report")).toBe("tier1_primary");
    expect(tierForUrl("https://data.knbs.or.ke/x")).toBe("tier1_primary");
    expect(tierForUrl("https://www.pesacheck.org/a")).toBe("tier2_established_media");
    expect(isAuthoritativeTier("tier1_primary")).toBe(true);
    expect(isAuthoritativeTier("tier2_established_media")).toBe(true);
  });

  it("degrades an unknown or unparseable host to tier3_general (never dropped)", () => {
    expect(tierForUrl("https://some-random-blog.example/x")).toBe("tier3_general");
    expect(tierForUrl("not a url")).toBe("tier3_general");
    expect(isAuthoritativeTier("tier3_general")).toBe(false);
  });
});

describe("submitClaimSource (ADR-0038 Wave 2)", () => {
  it("accepts a tier≤2 source, persists it, bumps last_activity, and does not enqueue below threshold", async () => {
    const store = new InMemoryClaimSourceStore();
    const publisher = new FakePublisher();
    const checkId = openCheck(store);

    const res = await submitClaimSource(store, deps(publisher), {
      checkId,
      url: "https://knbs.or.ke/release",
      note: "official figure",
      deviceHash: "dh-1",
    });

    expect(res).toMatchObject({ ok: true, httpStatus: 201, value: { status: "accepted", reVerifyQueued: false } });
    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]).toMatchObject({ status: "accepted", credibilityTier: "tier1_primary" });
    expect(store.bumped).toEqual([checkId]);
    expect(publisher.published).toHaveLength(0);
  });

  it("rejects a tier3/unknown source as community context (kept, never enqueued)", async () => {
    const store = new InMemoryClaimSourceStore();
    const publisher = new FakePublisher();
    const checkId = openCheck(store);

    const res = await submitClaimSource(store, deps(publisher), {
      checkId,
      url: "https://random-blog.example/post",
      note: null,
      deviceHash: "dh-1",
    });

    expect(res).toMatchObject({ ok: true, value: { status: "rejected", reVerifyQueued: false } });
    expect(store.inserted[0]).toMatchObject({ status: "rejected", credibilityTier: "tier3_general" });
    expect(publisher.published).toHaveLength(0);
  });

  it("dedups a repeat (check,url) as an idempotent duplicate — no second insert, no enqueue", async () => {
    const store = new InMemoryClaimSourceStore();
    const publisher = new FakePublisher();
    const checkId = openCheck(store);
    const url = "https://knbs.or.ke/release";

    await submitClaimSource(store, deps(publisher), { checkId, url, note: null, deviceHash: "dh-1" });
    const second = await submitClaimSource(store, deps(publisher), { checkId, url, note: null, deviceHash: "dh-2" });

    expect(second).toMatchObject({ ok: true, httpStatus: 200, value: { status: "duplicate", reVerifyQueued: false } });
    expect(store.inserted).toHaveLength(1);
  });

  it("404s for an unknown check", async () => {
    const store = new InMemoryClaimSourceStore();
    const res = await submitClaimSource(store, deps(new FakePublisher()), {
      checkId: randomUUID(),
      url: "https://knbs.or.ke/x",
      note: null,
      deviceHash: "dh-1",
    });
    expect(res).toMatchObject({ ok: false, httpStatus: 404, error: { code: "not_found" } });
  });

  it("409s when the check is not in an open thread (e.g. published)", async () => {
    const store = new InMemoryClaimSourceStore();
    const checkId = randomUUID();
    store.seedCheck(checkId, {
      lifecycleState: "published",
      claimText: "x",
      submissionId: randomUUID(),
      orgId: randomUUID(),
    });

    const res = await submitClaimSource(store, deps(new FakePublisher()), {
      checkId,
      url: "https://knbs.or.ke/x",
      note: null,
      deviceHash: "dh-1",
    });
    expect(res).toMatchObject({ ok: false, httpStatus: 409, error: { code: "lifecycle_closed" } });
    expect(store.inserted).toHaveLength(0);
  });

  it("enqueues a re-verify once the accepted tier≤2 count reaches the threshold, with the injected_docs payload", async () => {
    const store = new InMemoryClaimSourceStore();
    const publisher = new FakePublisher();
    const checkId = randomUUID();
    const submissionId = randomUUID();
    const orgId = randomUUID();
    store.seedCheck(checkId, { lifecycleState: "awaiting_sources", claimText: "GDP grew 5%.", submissionId, orgId });

    const first = await submitClaimSource(store, deps(publisher, 2), {
      checkId,
      url: "https://knbs.or.ke/a",
      note: "first source",
      deviceHash: "dh-1",
    });
    expect(first).toMatchObject({ value: { status: "accepted", reVerifyQueued: false } });
    expect(publisher.published).toHaveLength(0);

    const second = await submitClaimSource(store, deps(publisher, 2), {
      checkId,
      url: "https://pesacheck.org/b",
      note: "second source",
      deviceHash: "dh-2",
    });
    expect(second).toMatchObject({ value: { status: "accepted", reVerifyQueued: true } });
    expect(publisher.published).toHaveLength(1);

    const published = publisher.published[0]!;
    expect(published.url).toBe(REVERIFY_URL);
    expect(published.deduplicationId).toBe(`reverify-${checkId}-2`);
    const payload = published.body as ReverifyPayload;
    // Payload is a valid pipeline VerifyHopRequest (no reverify/check_id keys —
    // the hop re-identifies the check via submission_id and tells a re-verify
    // apart by injected_docs being present).
    expect(payload.submission_id).toBe(submissionId);
    expect(payload.org_id).toBe(orgId);
    expect(payload.claim_text).toBe("GDP grew 5%.");
    expect(payload.language).toBe("en");
    expect(payload.injected_docs).toHaveLength(2);
    expect(payload.injected_docs).toEqual(
      expect.arrayContaining([
        { url: "https://knbs.or.ke/a", title: "knbs.or.ke", text: "first source" },
        { url: "https://pesacheck.org/b", title: "pesacheck.org", text: "second source" },
      ]),
    );
  });
});

describe("resolveUrlServerSide", () => {
  it("returns the final (post-redirect) URL on success", async () => {
    const fakeFetch = (async () =>
      ({ ok: true, status: 200, url: "https://knbs.or.ke/final" }) as unknown as Response) as typeof fetch;
    expect(await resolveUrlServerSide("https://knbs.or.ke/short", fakeFetch)).toBe("https://knbs.or.ke/final");
  });

  it("returns null when both HEAD and GET fail (never throws)", async () => {
    const fakeFetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    expect(await resolveUrlServerSide("https://unreachable.example", fakeFetch)).toBeNull();
  });
});
