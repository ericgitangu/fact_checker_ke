"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getDeviceToken } from "../lib/device-token";
import type { AddSourceFormCopy } from "../lib/lifecycle-copy";

/**
 * ADR-0038 Wave 2 "Submit the truth": the interactive add-source island the
 * lifecycle affordance CTA opens. Collapsed by default to a single text button
 * (the CTA label, e.g. "Help verify →" / "Submit the truth →"); clicking it
 * reveals an inline URL + optional-note form that POSTs to the BFF proxy
 * (`/api/checks/:id/sources`) with the anonymous device token (same seam as the
 * submit flow — lib/device-token.ts). On success it collapses to an inline ack.
 *
 * Design-system only: reuses the existing `.lifecycle-affordance-cta`,
 * `.form-note*`, `.btn*`, and `.smart-input` tokens — no new palette (per
 * "reuse the design system; do not restyle").
 */
type FormState =
  | { status: "idle" }
  | { status: "open" }
  | { status: "submitting" }
  | { status: "done"; ack: string }
  | { status: "error"; message: string };

export function AddSourceForm({
  checkId,
  triggerLabel,
  copy,
  resource = "checks",
}: {
  /** The id to attach the source to — a check id ("checks") or, for a trending
   * card where the draft id is never exposed, a submission id ("submissions"). */
  checkId: string;
  triggerLabel: string;
  copy: AddSourceFormCopy;
  resource?: "checks" | "submissions";
}): React.JSX.Element {
  const router = useRouter();
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setState({ status: "submitting" });
    try {
      const deviceToken = await getDeviceToken();
      const res = await fetch(`/api/${resource}/${checkId}/sources`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(deviceToken ? { "x-device-token": deviceToken } : {}),
        },
        body: JSON.stringify({ url, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      if (res.status === 401) {
        // Gated action, not signed in: route to the sign-in flow with a
        // return-to so they land back on this exact check/trending card after
        // Google (which does a full redirect to callbackUrl, so the session
        // cookie is fresh on return regardless).
        const returnTo = `${window.location.pathname}${window.location.search}`;
        router.push(`/signin?callbackUrl=${encodeURIComponent(returnTo)}`);
        return;
      }
      if (res.status === 200 || res.status === 201) {
        const body = (await res.json().catch(() => ({}))) as {
          status?: "accepted" | "rejected" | "duplicate";
          reVerifyQueued?: boolean;
        };
        // Mirror services/api submitClaimSource's ClaimSourceOutcome exactly —
        // `status` + `reVerifyQueued` is all the client gets, and it's enough to
        // be honest about what actually happens next: a re-check only fires when
        // this accepted source crossed the threshold (`reVerifyQueued: true`).
        // Never promise "we'll re-check" for an accepted-but-below-threshold or
        // a rejected (non-credible domain) source.
        const ack =
          body.status === "duplicate"
            ? copy.ackDuplicate
            : body.status === "rejected"
              ? copy.ackRejected
              : body.reVerifyQueued
                ? copy.ackQueued
                : copy.ackAcceptedPending;
        setState({ status: "done", ack });
        return;
      }
      setState({ status: "error", message: copy.error });
    } catch {
      setState({ status: "error", message: copy.error });
    }
  }

  if (state.status === "done") {
    return (
      <p className="feedcard-caveat-note lifecycle-affordance-cta" role="status">
        {state.ack}
      </p>
    );
  }

  if (state.status === "idle") {
    return (
      <button
        type="button"
        className="feedcard-caveat-note lifecycle-affordance-cta"
        onClick={() => setState({ status: "open" })}
      >
        {triggerLabel} →
      </button>
    );
  }

  const submitting = state.status === "submitting";
  return (
    <form onSubmit={handleSubmit} className="add-source-form">
      <label htmlFor={`add-source-url-${checkId}`} className="sr-only">
        {copy.urlLabel}
      </label>
      <input
        id={`add-source-url-${checkId}`}
        type="url"
        className="smart-input"
        placeholder={copy.urlPlaceholder}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        required
        disabled={submitting}
      />
      <label htmlFor={`add-source-note-${checkId}`} className="sr-only">
        {copy.noteLabel}
      </label>
      <input
        id={`add-source-note-${checkId}`}
        type="text"
        className="smart-input"
        placeholder={copy.notePlaceholder}
        value={note}
        maxLength={2000}
        onChange={(e) => setNote(e.target.value)}
        disabled={submitting}
      />
      <div className="add-source-form-actions" style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting || !url.trim()}>
          {submitting ? copy.submitting : copy.submit}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setState({ status: "idle" })}
          disabled={submitting}
        >
          {copy.cancel}
        </button>
      </div>
      {state.status === "error" && (
        <p className="form-note form-note-error" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
