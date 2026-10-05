// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { VCardDownloadButton } from "./vcard-download-button";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * jsdom does not implement `URL.createObjectURL`/`revokeObjectURL` (throws
 * "not implemented"), so this test stubs just those two — locally, not in
 * the shared `vitest.setup.ts` — to verify the click handler's actual
 * browser-API contract: it builds a Blob, obtains an object URL, clicks a
 * synthetic anchor with that URL and a `.vcf` filename, then revokes the
 * URL. `buildFounderVCard`'s own content is covered separately in
 * `lib/contact.test.ts`.
 */
describe("VCardDownloadButton", () => {
  it("creates an object URL for a vcard Blob, triggers an anchor download, then revokes the URL", () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...globalThis.URL, createObjectURL, revokeObjectURL });

    const { getByRole } = render(
      <VCardDownloadButton label="Download vCard (.vcf)" downloadedLabel="Saved" />,
    );
    const button = getByRole("button", { name: "Download vCard (.vcf)" });
    fireEvent.click(button);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const [blobArg] = createObjectURL.mock.calls[0];
    expect(blobArg.type).toContain("text/vcard");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(getByRole("button", { name: "Saved" })).toBeTruthy();
  });
});
