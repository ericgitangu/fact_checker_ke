/**
 * Client-side seam for ADR-0027 (user media uploads): signed direct-to-
 * GCS upload, server only mediates the signed URL. services/api has no
 * `/v1/uploads/slot` endpoint yet (same "not implemented, this is the
 * seam" pattern as lib/editor-client.ts) — the BFF route
 * (app/api/uploads/slot/route.ts) tries it, and on failure falls back to
 * a same-origin mock PUT target (app/api/uploads/mock-put/route.ts) so
 * the upload-progress UI is exercised against a REAL HTTP upload (real
 * XHR progress events), not a setTimeout-simulated fake — it just doesn't
 * go to GCS and nothing is scanned/retained (the mock route drains and
 * discards the body).
 *
 * Per ADR-0027: a rights-attestation flag is REQUIRED before a slot is
 * issued (AT-0027-1) — this client enforces it too (fails fast, no
 * network round-trip for an attestation-less request), but the
 * authoritative check is server-side.
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB, per ADR-0027
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB, per ADR-0027
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);

export class MediaValidationError extends Error {}

export function validateOwnMediaFile(file: File): void {
  const isImage = ALLOWED_IMAGE_TYPES.has(file.type);
  const isVideo = ALLOWED_VIDEO_TYPES.has(file.type);
  if (!isImage && !isVideo) {
    throw new MediaValidationError("Unsupported file type. Use JPEG/PNG/WebP images or MP4/MOV video.");
  }
  if (isImage && file.size > MAX_IMAGE_BYTES) {
    throw new MediaValidationError("Images must be 10 MB or smaller.");
  }
  if (isVideo && file.size > MAX_VIDEO_BYTES) {
    throw new MediaValidationError("Video must be 200 MB or smaller (and under ~3 minutes).");
  }
}

export interface UploadSlot {
  uploadUrl: string;
  assetId: string;
  mock: boolean;
}

export async function requestUploadSlot(
  file: File,
  rightsAttested: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadSlot> {
  if (!rightsAttested) {
    throw new MediaValidationError("Rights attestation is required before requesting an upload slot.");
  }
  validateOwnMediaFile(file);

  const res = await fetchImpl("/api/uploads/slot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      rightsAttested,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to request an upload slot: ${res.status}`);
  }
  return (await res.json()) as UploadSlot;
}

/**
 * PUTs `file` to `uploadUrl` using XMLHttpRequest (not `fetch`) because
 * `fetch` has no cross-browser upload-progress event — `onProgress` here
 * reflects real bytes-sent-so-far against whatever `uploadUrl` is (the
 * mock route in dev, a real signed GCS URL once services/api implements
 * ADR-0027).
 */
export function putMedia(
  file: File,
  uploadUrl: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(file);
  });
}
