import { describe, it, expect, vi } from "vitest";
import { validateOwnMediaFile, requestUploadSlot, MediaValidationError, MAX_IMAGE_BYTES } from "./own-media-upload";

function makeFile(name: string, type: string, size: number): File {
  const file = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("validateOwnMediaFile", () => {
  it("accepts a small JPEG", () => {
    expect(() => validateOwnMediaFile(makeFile("a.jpg", "image/jpeg", 1024))).not.toThrow();
  });

  it("rejects an oversized image", () => {
    expect(() => validateOwnMediaFile(makeFile("a.jpg", "image/jpeg", MAX_IMAGE_BYTES + 1))).toThrow(
      MediaValidationError,
    );
  });

  it("rejects an unsupported type", () => {
    expect(() => validateOwnMediaFile(makeFile("a.gif", "image/gif", 1024))).toThrow(MediaValidationError);
  });

  it("accepts a small MP4", () => {
    expect(() => validateOwnMediaFile(makeFile("a.mp4", "video/mp4", 1024))).not.toThrow();
  });
});

describe("requestUploadSlot", () => {
  it("throws without a network call when rights are not attested", async () => {
    const fetchImpl = vi.fn();
    await expect(
      requestUploadSlot(makeFile("a.jpg", "image/jpeg", 1024), false, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(MediaValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs to /api/uploads/slot when rights are attested", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ uploadUrl: "/api/uploads/mock-put/x", assetId: "x", mock: true }), {
        status: 200,
      }),
    );
    const slot = await requestUploadSlot(
      makeFile("a.jpg", "image/jpeg", 1024),
      true,
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/uploads/slot",
      expect.objectContaining({ method: "POST" }),
    );
    expect(slot.mock).toBe(true);
  });
});
