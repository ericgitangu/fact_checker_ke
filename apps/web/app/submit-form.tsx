"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getDeviceToken } from "../lib/device-token";
import { detectSource, isShortenerUrl } from "../lib/claim-source-detection";
import { detectLanguages } from "../lib/language-detect";
import { SourcePreview } from "../components/submit/source-preview";
import { VideoMomentMarker } from "../components/submit/video-moment-marker";
import { MediaDropzone } from "../components/submit/media-dropzone";
import { LanguageChips } from "../components/submit/language-chips";
import { NextStepsPreview } from "../components/submit/next-steps-preview";
import { AwaitingReviewStamp } from "../components/submit/awaiting-review-stamp";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; id: string }
  | { status: "error"; message: string };

function randomIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The "smart input" submit screen (redesigned per owner escalation,
 * 2026-10-03). One prominent field replaces the old cold 3-field form;
 * everything else (video moment marker, media upload, language chips,
 * next-steps preview) is progressive disclosure driven by client-side
 * detection on what was pasted — see lib/claim-source-detection.ts and
 * lib/language-detect.ts for the (heuristic, no-backend-call) detection
 * logic itself.
 */
export function SubmitForm({ initialUrl = "" }: { initialUrl?: string } = {}): React.JSX.Element {
  const t = useTranslations("submit");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [rawInput, setRawInput] = useState(initialUrl);
  const [quote, setQuote] = useState("");
  const [timestampSec, setTimestampSec] = useState(0);
  // Captured for the upload UI's own lifecycle, but NOT yet sent with the
  // submission: SubmissionInputSchema (packages/core, read-only to this
  // agent) has no field for an attached media asset id today. This is a
  // documented gap, not a silent drop — see the final report's seam list.
  const [uploadedAssetId, setUploadedAssetId] = useState<string | null>(null);
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );

  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Shortener resolution (share.google, bit.ly, …): the platform behind a
  // short link is unknowable client-side, so /api/resolve-url follows it and
  // detection runs on the RESOLVED url. `resolution.for` pins the result to the
  // exact input it was computed for, so stale results never apply after typing.
  const trimmedInput = rawInput.trim();
  const [resolution, setResolution] = useState<{ for: string; url: string } | null>(null);
  const needsResolve = isShortenerUrl(trimmedInput);
  const resolvedUrl = resolution?.for === trimmedInput ? resolution.url : null;
  const resolving = needsResolve && resolvedUrl === null;

  useEffect(() => {
    if (!isShortenerUrl(trimmedInput)) return;
    const controller = new AbortController();
    const debounce = setTimeout(() => {
      void fetch("/api/resolve-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: trimmedInput }),
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: unknown) => {
          const url =
            typeof body === "object" && body !== null && "resolvedUrl" in body
              ? (body as { resolvedUrl: unknown }).resolvedUrl
              : null;
          setResolution({ for: trimmedInput, url: typeof url === "string" ? url : trimmedInput });
        })
        .catch(() => {
          // Aborted (further typing) is expected; a real failure falls back to
          // the original link so submit is never stuck behind a dead resolver.
          if (!controller.signal.aborted) setResolution({ for: trimmedInput, url: trimmedInput });
        });
    }, 300);
    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
  }, [trimmedInput]);

  const detection = useMemo(() => detectSource(resolvedUrl ?? rawInput), [resolvedUrl, rawInput]);
  const languageSampleText = detection.kind === "text" ? detection.text : quote;
  const languages = useMemo(
    () => (languageSampleText.trim() ? detectLanguages(languageSampleText) : []),
    [languageSampleText],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (detection.kind === "empty") {
      setState({ status: "error", message: t("error.empty") });
      return;
    }
    if (resolving) return;
    setState({ status: "submitting" });
    try {
      const deviceToken = await getDeviceToken();
      const idempotencyKey = randomIdempotencyKey();

      const trimmedQuote = quote.trim();
      const payload =
        detection.kind === "url"
          ? {
              url: detection.url,
              ...(detection.isVideoPlatform && trimmedQuote ? { quote: trimmedQuote } : {}),
              ...(detection.isVideoPlatform && trimmedQuote ? { timestampSec } : {}),
            }
          : { text: detection.text };

      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          ...(deviceToken ? { "x-device-token": deviceToken } : {}),
        },
        body: JSON.stringify(payload),
      });
      // Auth gate (return-to): the BFF requires a session; a logged-out submit
      // gets 401, so route to sign-in with this page as the callback rather than
      // surfacing a bare "failed with status 401".
      if (res.status === 401) {
        router.push(`/signin?callbackUrl=${encodeURIComponent("/submit")}`);
        return;
      }
      if (res.status !== 202) {
        const body: unknown = await res.json().catch(() => ({}));
        const message =
          typeof body === "object" && body !== null && "message" in body
            ? String((body as { message: unknown }).message)
            : `Submission failed with status ${res.status}`;
        setState({ status: "error", message });
        return;
      }
      const body = (await res.json()) as { id: string };
      setState({ status: "success", id: body.id });
      router.push(`/submissions/${body.id}`);
    } catch {
      setState({ status: "error", message: t("error.network") });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="smart-submit" aria-describedby={isOffline ? "offline-note" : undefined}>
      {isOffline && (
        <p id="offline-note" className="form-note form-note-muted" role="status">
          {t("error.offline")}
        </p>
      )}

      <div className="smart-input-wrap">
        <label htmlFor="smart-input" className="sr-only">
          {t("smartInput.label")}
        </label>
        <textarea
          id="smart-input"
          className="smart-input"
          placeholder={t("smartInput.placeholder")}
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          rows={3}
        />
      </div>

      {resolving && (
        <p className="form-note form-note-muted" role="status">
          {t("resolving")}
        </p>
      )}

      {detection.kind === "url" && !resolving && (
        <>
          <SourcePreview detection={detection} />
          {detection.isVideoPlatform && (
            <VideoMomentMarker
              detection={detection}
              timestampSec={timestampSec}
              onTimestampChange={setTimestampSec}
              quote={quote}
              onQuoteChange={setQuote}
            />
          )}
        </>
      )}

      {detection.kind === "text" && (
        <span className="detected-pill reveal-in">
          <span className="dot" aria-hidden="true" />
          {t("detected.text")}
        </span>
      )}

      {languages.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 style={{ fontSize: "0.85rem", color: "var(--ink-3)" }}>{t("languages.heading")}</h3>
          <LanguageChips languages={languages} />
        </div>
      )}

      <MediaDropzone onUploaded={setUploadedAssetId} />
      {uploadedAssetId && (
        // Honest gap, surfaced rather than hidden: SubmissionInputSchema
        // (packages/core) has no field to carry an uploaded media asset
        // id yet, so this upload is captured but not yet attached to the
        // submission below. See the final report's seam list.
        <p className="trust-note" role="status">
          Media uploaded (asset {uploadedAssetId.slice(0, 8)}…) — not yet linked to this submission; that
          contract needs a core schema update.
        </p>
      )}

      <NextStepsPreview />

      <div className="submit-cta-row" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <AwaitingReviewStamp />
        <button type="submit" className="btn btn-primary" disabled={state.status === "submitting" || isOffline || resolving}>
          {state.status === "submitting" ? tCommon("action.submitting") : tCommon("action.submit")}
        </button>
      </div>

      {state.status === "success" && (
        <p className="form-note form-note-success" role="status">
          {t("success")}
        </p>
      )}
      {state.status === "error" && (
        <p className="form-note form-note-error" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
