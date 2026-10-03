"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  MediaValidationError,
  putMedia,
  requestUploadSlot,
  validateOwnMediaFile,
} from "../../lib/own-media-upload";

type UploadState =
  | { status: "idle" }
  | { status: "selected"; file: File }
  | { status: "uploading"; file: File; fraction: number }
  | { status: "done"; file: File; assetId: string }
  | { status: "error"; message: string };

/**
 * ADR-0027 client seam: drag-and-drop + click-to-browse + paste-from-
 * clipboard for the user's own photo/video. The rights-attestation
 * checkbox is required before `requestUploadSlot` is even called
 * (enforced again server-side, see app/api/uploads/slot/route.ts). The
 * actual upload target is a mock in this wave (see lib/own-media-
 * upload.ts) — the progress bar reflects a real HTTP PUT, just to a
 * same-origin route that discards the body rather than real GCS.
 */
export function MediaDropzone({
  onUploaded,
}: {
  onUploaded: (assetId: string | null) => void;
}): React.JSX.Element {
  const t = useTranslations("submit");
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [rightsAttested, setRightsAttested] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function startUpload(file: File): Promise<void> {
    try {
      validateOwnMediaFile(file);
    } catch (err) {
      setState({ status: "error", message: err instanceof MediaValidationError ? err.message : "Invalid file." });
      return;
    }
    setState({ status: "selected", file });
  }

  async function confirmUpload(file: File): Promise<void> {
    setState({ status: "uploading", file, fraction: 0 });
    try {
      const slot = await requestUploadSlot(file, rightsAttested);
      await putMedia(file, slot.uploadUrl, (fraction) => setState({ status: "uploading", file, fraction }));
      setState({ status: "done", file, assetId: slot.assetId });
      onUploaded(slot.assetId);
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Upload failed." });
      onUploaded(null);
    }
  }

  function handleFiles(files: FileList | null): void {
    const file = files?.[0];
    if (file) void startUpload(file);
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 style={{ fontSize: "1rem" }}>{t("upload.heading")}</h3>

      {state.status === "idle" && (
        <div
          className="media-dropzone"
          data-dragover={dragOver}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData.files)[0];
            if (file) void startUpload(file);
          }}
        >
          <span className="media-dropzone-icon" aria-hidden="true">
            +
          </span>
          <span>{t("upload.help")}</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      )}

      {state.status === "selected" && (
        <div className="flex flex-col gap-3">
          <div className="media-file-row">
            <span>{state.file.name}</span>
          </div>
          <label className="rights-attestation">
            <input
              type="checkbox"
              checked={rightsAttested}
              onChange={(e) => setRightsAttested(e.target.checked)}
            />
            <span>{t("upload.rights")}</span>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!rightsAttested}
            onClick={() => void confirmUpload(state.file)}
          >
            {t("upload.heading")}
          </button>
        </div>
      )}

      {state.status === "uploading" && (
        <div className="media-file-row">
          <span>{t("upload.uploading")}</span>
          <div className="media-progress-track">
            <div className="media-progress-fill" style={{ width: `${Math.round(state.fraction * 100)}%` }} />
          </div>
        </div>
      )}

      {state.status === "done" && (
        <div className="media-file-row">
          <span>✓ {t("upload.uploaded")}</span>
          <span style={{ color: "var(--ink-3)" }}>{state.file.name}</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setState({ status: "idle" });
              setRightsAttested(false);
              onUploaded(null);
            }}
          >
            {t("upload.remove")}
          </button>
        </div>
      )}

      {state.status === "error" && (
        <p className="form-note form-note-error" role="alert">
          {state.message}
        </p>
      )}

      <p className="trust-note">{t("upload.trust")}</p>
    </div>
  );
}
