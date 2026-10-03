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
}: {
  submissionId: string;
  initialStatus: SubmissionStatus;
}): React.JSX.Element {
  const t = useTranslations("status");
  const tCheck = useTranslations("check");
  const [status, setStatus] = useState<SubmissionStatus>(initialStatus);
  const [mode, setMode] = useState<"sse" | "polling">("sse");

  useEffect(() => {
    if (initialStatus === "ready" || initialStatus === "failed") return;
    const handle = subscribeToSubmissionEvents(submissionId, {
      onStatus: setStatus,
      onModeChange: setMode,
    });
    return () => handle.close();
  }, [submissionId, initialStatus]);

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
      {status === "ready" && (
        // KNOWN GAP: `SubmissionSchema` (packages/core) has no `checkId`
        // field, and a Check's `id` is distinct from its `submissionId` —
        // there is currently no documented way for the client to learn a
        // submission's resulting check id. We optimistically try the
        // submission id as the check id (true for a naive 1:1 pipeline
        // implementation, but not guaranteed by the schema); the real fix
        // is for the `check.published` event / `GET /v1/submissions/:id`
        // response to carry `checkId` explicitly. Flagging rather than
        // silently assuming this always resolves.
        <a className="btn btn-primary" style={{ alignSelf: "flex-start" }} href={`/checks/${submissionId}`}>
          {t("viewCheck")}
        </a>
      )}
    </div>
  );
}
