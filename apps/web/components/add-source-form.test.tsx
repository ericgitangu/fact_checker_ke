// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AddSourceForm } from "./add-source-form";
import { addSourceFormCopyFor } from "../lib/lifecycle-copy";

vi.mock("../lib/device-token", () => ({
  getDeviceToken: vi.fn(async () => "device-token-xyz"),
}));

const copy = addSourceFormCopyFor("en");
const CHECK_ID = "11111111-1111-1111-1111-111111111111";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openForm() {
  const utils = render(<AddSourceForm checkId={CHECK_ID} triggerLabel="Help verify" copy={copy} />);
  fireEvent.click(utils.getByRole("button", { name: /Help verify/ }));
  return utils;
}

describe("AddSourceForm (ADR-0038 Wave 2)", () => {
  it("renders a collapsed CTA button that opens the inline form", () => {
    const { getByRole, getByPlaceholderText } = openForm();
    expect(getByPlaceholderText(copy.urlPlaceholder)).toBeTruthy();
    expect(getByRole("button", { name: copy.submit })).toBeTruthy();
  });

  it("POSTs to the BFF with the device token and shows the queued ack when the threshold is crossed", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "accepted", reVerifyQueued: true }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole, getByPlaceholderText, findByText } = openForm();
    fireEvent.change(getByPlaceholderText(copy.urlPlaceholder), { target: { value: "https://knbs.or.ke/x" } });
    fireEvent.click(getByRole("button", { name: copy.submit }));

    expect(await findByText(copy.ackQueued)).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(`/api/checks/${CHECK_ID}/sources`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-device-token"]).toBe("device-token-xyz");
    expect(JSON.parse(init.body as string)).toEqual({ url: "https://knbs.or.ke/x" });
  });

  it("shows the accepted-pending ack when accepted but below the re-verify threshold", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "accepted", reVerifyQueued: false }), { status: 201 })),
    );
    const { getByRole, getByPlaceholderText, findByText } = openForm();
    fireEvent.change(getByPlaceholderText(copy.urlPlaceholder), { target: { value: "https://knbs.or.ke/x" } });
    fireEvent.click(getByRole("button", { name: copy.submit }));
    expect(await findByText(copy.ackAcceptedPending)).toBeTruthy();
  });

  it("shows the rejected ack when the source is from a non-credible domain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "rejected", reVerifyQueued: false }), { status: 201 })),
    );
    const { getByRole, getByPlaceholderText, findByText } = openForm();
    fireEvent.change(getByPlaceholderText(copy.urlPlaceholder), { target: { value: "https://example-blog.test/x" } });
    fireEvent.click(getByRole("button", { name: copy.submit }));
    expect(await findByText(copy.ackRejected)).toBeTruthy();
  });

  it("shows the duplicate ack when the API reports a duplicate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "duplicate", reVerifyQueued: false }), { status: 200 })),
    );
    const { getByRole, getByPlaceholderText, findByText } = openForm();
    fireEvent.change(getByPlaceholderText(copy.urlPlaceholder), { target: { value: "https://knbs.or.ke/x" } });
    fireEvent.click(getByRole("button", { name: copy.submit }));
    expect(await findByText(copy.ackDuplicate)).toBeTruthy();
  });

  it("shows an error on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "lifecycle_closed" }), { status: 409 })));
    const { getByRole, getByPlaceholderText, findByText } = openForm();
    fireEvent.change(getByPlaceholderText(copy.urlPlaceholder), { target: { value: "https://knbs.or.ke/x" } });
    fireEvent.click(getByRole("button", { name: copy.submit }));
    expect(await findByText(copy.error)).toBeTruthy();
  });
});
