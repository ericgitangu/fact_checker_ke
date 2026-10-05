"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { SubmissionStatus } from "@fact-checker-ke/core";
import { subscribeToSubmissionEvents } from "../lib/submission-events";

const ORDER: SubmissionStatus[] = ["received", "analyzing", "analyzed", "verifying", "ready"];

function stateFor(current: SubmissionStatus, step: SubmissionStatus): "done" | "active" | "pending" | "failed" {
  if (current === "failed") {
    return step === "failed" ? "failed" : "pending";
  }
  const currentIdx = ORDER.indexOf(current);
  const stepIdx = ORDER.indexOf(step);
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

/**
 * Client component: opens the SSE connection (lib/submission-events.ts)
 * for `submissionId` and renders the received -> analyzing -> analyzed ->
 * verifying -> ready|failed pipeline live, with honest "AI-assisted
 * analysis — not a verdict" labelling throughout the pre-publish states
 * (ADR-0028 / AT-0004-B neighbourhood).
 */
export function StatusTracker({
  submissionId,
  initialStatus,
  initialCheckId = null,
  initialCheckPublished = false,
}: {
  submissionId: string;
  initialStatus: SubmissionStatus;
  /** The REAL resulting check id (distinct from submissionId), when known
   * server-side at page load. Null while in-flight — resolved via a refetch
   * once the tracker reaches `ready` through SSE/polling (see below). */
  initialCheckId?: string | null;
  initialCheckPublished?: boolean;
}): React.JSX.Element {
  const t = useTranslations("status");
  const tCheck = useTranslations("check");
  const [status, setStatus] = useState<SubmissionStatus>(initialStatus);
  const [mode, setMode] = useState<"sse" | "polling">("sse");
  const [checkId, setCheckId] = useState<string | null>(initialCheckId);
  const [checkPublished, setCheckPublished] = useState<boolean>(initialCheckPublished);

  useEffect(() => {
    if (initialStatus === "ready" || initialStatus === "failed") return;
    const handle = subscribeToSubmissionEvents(submissionId, {
      onStatus: setStatus,
      onModeChange: setMode,
    });
    return () => handle.close();
  }, [submissionId, initialStatus]);

  // When the tracker reaches `ready` via SSE/polling (i.e. the user watched
  // it finish rather than landing on an already-complete page), the check
  // id is not yet known client-side — a held draft never emits a
  // check.published event, so the id can only come from the submission
  // resource. Resolve it once, via the same BFF the polling fallback uses.
  useEffect(() => {
    if (status !== "ready" || checkId !== null) return;
    let cancelled = false;
    void fetch(`/api/submissions/${encodeURIComponent(submissionId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (cancelled || body === null || typeof body !== "object") return;
        const id = (body as { checkId?: unknown }).checkId;
        const published = (body as { checkPublished?: unknown }).checkPublished;
        if (typeof id === "string") setCheckId(id);
        if (typeof published === "boolean") setCheckPublished(published);
      })
      .catch(() => {
        // Non-fatal: the tracker still shows the terminal `ready` state;
        // only the follow-on link is unavailable this render.
      });
    return () => {
      cancelled = true;
    };
  }, [status, checkId, submissionId]);

  const steps: SubmissionStatus[] = status === "failed" ? ["failed"] : ORDER;

  return (
    <div className="flex flex-col gap-4">
      {status !== "ready" && status !== "failed" && (
        <p className="ai-assisted-note" style={{ alignSelf: "flex-start" }}>
          {tCheck("aiAssisted")}
        </p>
      )}
      {mode === "polling" && (
        <p className="form-note form-note-muted" role="status">
          {t("polling")}
        </p>
      )}
      <ol className="pipeline-track" aria-label={t("heading")}>
        {steps.map((step) => (
          <li key={step} data-state={stateFor(status, step)}>
            <h3>{t(`state.${step}`)}</h3>
            <p>{t(`desc.${step}`)}</p>
          </li>
        ))}
      </ol>
      {/* A held draft (ready, not yet published) is a COMPLETED run, but
          nothing is public yet — say so honestly rather than "view it
          below". Resolved the former "checkId == submissionId" guess:
          GET /v1/submissions/:id now carries the real check id. */}
      {status === "ready" && !checkPublished && (
        <p className="form-note form-note-muted" role="status">
          {t("readyHeld")}
        </p>
      )}
      {status === "ready" && checkId !== null && (
        <a className="btn btn-primary" style={{ alignSelf: "flex-start" }} href={`/checks/${checkId}`}>
          {checkPublished ? t("viewCheck") : t("viewReview")}
        </a>
      )}
    </div>
  );
}
