import { describe, expect, it } from "vitest";
import { deriveTrendingStatus } from "../lib/trending-status.js";

/**
 * Status derivation for the "Trending / under review" stream. A discovered
 * (fetch-sourced) item's public status is derived from its submission status
 * plus its OWN check's editorial lifecycle — NEVER from a draft's rating/verdict
 * (decision C: held drafts are not public).
 *
 * ADR-0038 honest-copy correction: `under_review` is now emitted ONLY for
 * `lifecycle_state === 'editor_review'`; a held `preliminary`/`awaiting_sources`
 * item (and any legacy held draft with a null lifecycle) reads `monitoring`,
 * not the old lie that "a human editor is assessing it".
 */
describe("deriveTrendingStatus", () => {
  it("monitoring while the pipeline is still assessing (in-flight submission)", () => {
    for (const status of ["received", "analyzing", "analyzed", "verifying"] as const) {
      expect(deriveTrendingStatus(status, null)).toEqual({ status: "monitoring", checkId: null });
    }
  });

  it("under_review ONLY when lifecycle_state is editor_review — no checkId exposed", () => {
    const escalated = {
      checkId: "11111111-1111-1111-1111-111111111111",
      isDraft: true,
      publishedAt: null,
      lifecycleState: "editor_review" as const,
    };
    expect(deriveTrendingStatus("ready", escalated)).toEqual({ status: "under_review", checkId: null });
  });

  it("monitoring (NOT under_review) for a preliminary / awaiting_sources / legacy held draft", () => {
    const base = { checkId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", isDraft: true, publishedAt: null };
    // ADR-0038: these autonomous non-terminal states must never claim a human
    // is assessing them.
    expect(deriveTrendingStatus("ready", { ...base, lifecycleState: "preliminary" })).toEqual({
      status: "monitoring",
      checkId: null,
    });
    expect(deriveTrendingStatus("ready", { ...base, lifecycleState: "awaiting_sources" })).toEqual({
      status: "monitoring",
      checkId: null,
    });
    // Legacy held draft with no lifecycle (backfilled pre-0038 / flag-off).
    expect(deriveTrendingStatus("ready", { ...base, lifecycleState: null })).toEqual({
      status: "monitoring",
      checkId: null,
    });
    expect(deriveTrendingStatus("ready", base)).toEqual({ status: "monitoring", checkId: null });
  });

  it("dismissed when lifecycle_state is dismissed or archived_expired", () => {
    const base = { checkId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", isDraft: true, publishedAt: null };
    expect(deriveTrendingStatus("ready", { ...base, lifecycleState: "dismissed" })).toEqual({
      status: "dismissed",
      checkId: null,
    });
    expect(deriveTrendingStatus("ready", { ...base, lifecycleState: "archived_expired" })).toEqual({
      status: "dismissed",
      checkId: null,
    });
  });

  it("published when a published check exists — links its checkId", () => {
    const published = {
      checkId: "22222222-2222-2222-2222-222222222222",
      isDraft: false,
      publishedAt: "2026-10-05T10:00:00.000Z",
    };
    expect(deriveTrendingStatus("ready", published)).toEqual({
      status: "published",
      checkId: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("dismissed when the submission failed", () => {
    expect(deriveTrendingStatus("failed", null)).toEqual({ status: "dismissed", checkId: null });
  });

  it("monitoring when ready but the item has no check of its own (deduped / no checkable claim)", () => {
    // e.g. the orchestrator deduped this discovery to an already-published
    // claim owned by a DIFFERENT submission — this item advanced to `ready`
    // with no check row of its own. We don't fabricate a published status from
    // another submission's check; it's still a tracked discovery.
    expect(deriveTrendingStatus("ready", null)).toEqual({ status: "monitoring", checkId: null });
  });

  it("published takes precedence over a stale submission status", () => {
    // Defensive: a published check is the strongest signal regardless of the
    // submission row's status column.
    const published = {
      checkId: "33333333-3333-3333-3333-333333333333",
      isDraft: false,
      publishedAt: "2026-10-05T10:00:00.000Z",
    };
    expect(deriveTrendingStatus("failed", published)).toEqual({
      status: "published",
      checkId: "33333333-3333-3333-3333-333333333333",
    });
  });
});
