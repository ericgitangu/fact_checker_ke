// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * AdSlot render contract (ADR-0012 §4):
 *   - renders NOTHING when AdSense env is unset (invisible until the owner
 *     adds an account);
 *   - when configured + free reader + consent satisfied, renders a LABELLED,
 *     height-reserved <ins class="adsbygoogle"> with the right client/slot;
 *   - renders NOTHING for a Premium (ad-free) reader.
 *
 * The entitlement + consent hooks are mocked so this test asserts AdSlot's
 * OWN rendering, not the network/consent plumbing (covered by their own
 * tests). Env is stubbed before a dynamic import because lib/ads reads the
 * NEXT_PUBLIC_* vars at module load.
 */

const adFreeMock = vi.fn(() => ({ adFree: false }) as { adFree: boolean });
const consentMock = vi.fn(() => ({ required: false, choice: undefined, satisfied: true, showBanner: false }));

vi.mock("../../lib/use-entitlement", () => ({ useEntitlement: () => adFreeMock() }));
vi.mock("../../lib/consent", () => ({ useAdsConsent: () => consentMock() }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  adFreeMock.mockReturnValue({ adFree: false });
  consentMock.mockReturnValue({ required: false, choice: undefined, satisfied: true, showBanner: false });
});

async function renderAdSlot() {
  const { renderWithIntl } = await import("../../test/render-with-intl");
  const { AdSlot } = await import("./ad-slot");
  return renderWithIntl(<AdSlot slot="inFeed" />);
}

describe("<AdSlot>", () => {
  it("renders nothing when NEXT_PUBLIC_ADSENSE_CLIENT is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT", "");
    vi.stubEnv("NEXT_PUBLIC_ADSENSE_SLOT_INFEED", "");
    const { container } = await renderAdSlot();
    expect(container.querySelector(".ad-slot")).toBeNull();
    expect(container.querySelector("ins.adsbygoogle")).toBeNull();
  });

  it("renders nothing when the client is set but this slot id is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT", "ca-pub-test");
    vi.stubEnv("NEXT_PUBLIC_ADSENSE_SLOT_INFEED", "");
    const { container } = await renderAdSlot();
    expect(container.querySelector(".ad-slot")).toBeNull();
  });

  it("renders a labelled, reserved ins with the client/slot when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT", "ca-pub-test");
    vi.stubEnv("NEXT_PUBLIC_ADSENSE_SLOT_INFEED", "slot-123");
    const { container, getByText } = await renderAdSlot();
    const slot = container.querySelector(".ad-slot");
    expect(slot).not.toBeNull();
    // Labelled "Ad" (real catalog string).
    expect(getByText("Ad")).toBeTruthy();
    const ins = container.querySelector("ins.adsbygoogle");
    expect(ins).not.toBeNull();
    expect(ins?.getAttribute("data-ad-client")).toBe("ca-pub-test");
    expect(ins?.getAttribute("data-ad-slot")).toBe("slot-123");
    // CLS-safe: a reserved height is set.
    expect((slot as HTMLElement).style.minHeight).not.toBe("");
  });

  it("renders nothing for a Premium (ad-free) reader even when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT", "ca-pub-test");
    vi.stubEnv("NEXT_PUBLIC_ADSENSE_SLOT_INFEED", "slot-123");
    adFreeMock.mockReturnValue({ adFree: true });
    const { container } = await renderAdSlot();
    expect(container.querySelector(".ad-slot")).toBeNull();
  });

  it("renders nothing when consent is required but not granted", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT", "ca-pub-test");
    vi.stubEnv("NEXT_PUBLIC_ADSENSE_SLOT_INFEED", "slot-123");
    consentMock.mockReturnValue({ required: true, choice: undefined, satisfied: false, showBanner: true });
    const { container } = await renderAdSlot();
    expect(container.querySelector(".ad-slot")).toBeNull();
  });
});
