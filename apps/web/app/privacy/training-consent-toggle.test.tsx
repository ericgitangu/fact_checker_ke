// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IntlProviderHarness } from "../../test/render-with-intl";
import { TrainingConsentToggle } from "./training-consent-toggle";

const localStorageStub = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

beforeEach(() => {
  localStorageStub.clear();
  vi.stubGlobal("localStorage", localStorageStub);
});

afterEach(() => {
  cleanup();
});

/**
 * ADR-0033 AT-0033-3 (ties to ADR-0021 AT-0021-6): the training-moat
 * consent is a granular, severable, revocable control. "Severable from
 * submitting a claim" is tested structurally — this component has no
 * dependency on, or coupling to, the submit flow, and renders as a plain
 * standalone control.
 */
describe("TrainingConsentToggle (ADR-0033 AT-0033-3)", () => {
  it("defaults to OFF (not pre-ticked) — consent must be freely given, never assumed", async () => {
    const { getByRole } = render(<IntlProviderHarness><TrainingConsentToggle /></IntlProviderHarness>);
    const checkbox = (await waitFor(() => getByRole("checkbox"))) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("granting consent persists the choice and is revocable (toggling off un-grants it)", async () => {
    const { getByRole } = render(<IntlProviderHarness><TrainingConsentToggle /></IntlProviderHarness>);
    const checkbox = (await waitFor(() => getByRole("checkbox"))) as HTMLInputElement;

    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(true));
    expect(JSON.parse(localStorageStub.getItem("fck_training_consent_v1") ?? "{}").granted).toBe(
      true,
    );

    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(false));
    expect(JSON.parse(localStorageStub.getItem("fck_training_consent_v1") ?? "{}").granted).toBe(
      false,
    );
  });

  it("a prior choice is read back on remount (persistence)", async () => {
    localStorageStub.setItem(
      "fck_training_consent_v1",
      JSON.stringify({ granted: true, updatedAt: new Date().toISOString() }),
    );
    const { getByRole } = render(<IntlProviderHarness><TrainingConsentToggle /></IntlProviderHarness>);
    const checkbox = (await waitFor(() => getByRole("checkbox"))) as HTMLInputElement;
    await waitFor(() => expect(checkbox.checked).toBe(true));
  });

  it("states the choice is optional and separate from submitting a claim", async () => {
    const { findByText } = render(<IntlProviderHarness><TrainingConsentToggle /></IntlProviderHarness>);
    expect(await findByText(/separate from submitting a claim/i)).toBeTruthy();
  });

  it("states special-category/protest content is excluded from training by default", async () => {
    const { findByText } = render(<IntlProviderHarness><TrainingConsentToggle /></IntlProviderHarness>);
    expect(await findByText(/excluded from training by default/i)).toBeTruthy();
  });
});
