// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { componentAxeOptions, expectNoAxeViolations } from "../test/axe-config";
import { renderWithIntl } from "../test/render-with-intl";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { SubmitForm } = await import("./submit-form");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The SubmitForm "smart input" discloses different sub-forms depending on
 * what's pasted (see claim-source-detection.ts / language-detect.ts) --
 * each disclosed state is its own real rendered surface and gets its own
 * axe pass, not just the empty default state.
 */
describe("SubmitForm a11y (AT-0028-2, submit-form surface)", () => {
  it("empty/default state: zero WCAG 2.2 AA violations", async () => {
    const { container } = renderWithIntl(<SubmitForm />);
    const results = await axe(container, componentAxeOptions);
    expectNoAxeViolations(results);
  });

  it("free-text input (reveals the language chips + detected-text pill): zero WCAG 2.2 AA violations", async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<SubmitForm />);
    const input = screen.getByLabelText(/paste a link or type a claim/i);
    await user.type(input, "Waziri anasema bei ya mafuta itashuka kesho, watu wanasema ni uongo.");

    await waitFor(() => expect(screen.getByText(/Detected language/i)).toBeInTheDocument());

    const results = await axe(container, componentAxeOptions);
    expectNoAxeViolations(results);
  });

  it("pasted YouTube URL (reveals source preview + video moment marker): zero WCAG 2.2 AA violations", async () => {
    const { container } = renderWithIntl(<SubmitForm />);
    const input = screen.getByLabelText(/paste a link or type a claim/i);
    // fireEvent.change (not userEvent.type) -- pasting a long URL
    // character-by-character via userEvent.type is unnecessary here and
    // slow; this still exercises the real onChange -> detectSource ->
    // conditional-render path, just via one event instead of ~40.
    fireEvent.change(input, {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });

    await waitFor(() => expect(screen.getByText(/YouTube video detected/i)).toBeInTheDocument());

    const results = await axe(container, componentAxeOptions);
    expectNoAxeViolations(results);
  });

  it("media dropzone 'selected' state (rights-attestation checkbox + confirm button): zero WCAG 2.2 AA violations", async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<SubmitForm />);
    // The input's accessible name comes from the <label> it's nested in
    // (components/submit/media-dropzone.tsx), whose text content is the
    // drag/click/paste help copy -- NOT the sibling "Or share your own
    // photo or video" <h3>, which is a visual heading, not a label.
    const fileInput = screen.getByLabelText(/drag a file here, click to browse/i, {
      selector: "input",
    }) as HTMLInputElement;
    const file = new File(["fake image bytes"], "evidence.jpg", { type: "image/jpeg" });
    await user.upload(fileInput, file);

    await waitFor(() => expect(screen.getByText("evidence.jpg")).toBeInTheDocument());

    const results = await axe(container, componentAxeOptions);
    expectNoAxeViolations(results);
  });

  it("error state (role=alert network-error note): zero WCAG 2.2 AA violations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))));
    const user = userEvent.setup();
    const { container } = renderWithIntl(<SubmitForm />);
    const input = screen.getByLabelText(/paste a link or type a claim/i);
    await user.type(input, "The minister said something checkable.");
    await user.click(screen.getByRole("button", { name: /check this/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const results = await axe(container, componentAxeOptions);
    expectNoAxeViolations(results);
  });
});
