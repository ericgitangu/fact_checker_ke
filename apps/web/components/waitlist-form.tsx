"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { WaitlistSignupInputSchema } from "@fact-checker-ke/core";
import { classifyWaitlistResponse } from "../lib/waitlist-outcome";

type WaitlistState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "joined" }
  | { status: "already_joined" }
  | { status: "invalid"; message: string }
  | { status: "rate_limited"; retryAfterSec: number | null }
  | { status: "server_error" }
  | { status: "unexpected" }
  | { status: "network_error" };

const BUSY_STATES: ReadonlySet<WaitlistState["status"]> = new Set(["submitting"]);

/**
 * Joins the fact_checker_ke waitlist. Ported from the retired apps/site
 * during the single-frontend consolidation (ADR-0010/0015 amendments). Two
 * things change from the apps/site original, both because this now runs
 * inside the Next.js app rather than a standalone Vite SPA:
 *
 * 1. It posts SAME-ORIGIN to the web BFF (`/api/waitlist`), which forwards
 *    to services/api server-side — so there is no VITE_API_URL /
 *    `resolveApiUrl` misconfiguration state and no CORS (ADR-0015's web
 *    posting model, matching app/api/submissions).
 * 2. Copy comes from the `landing` i18n namespace (EN + SW) via next-intl
 *    rather than being hardcoded English.
 *
 * Only `.safeParse` is used against the core schema (never `.parse` or a
 * direct `zod` import) so this stays correct regardless of packages/core's
 * zod major. `source` is stamped server-side by the BFF, so the client
 * only needs a valid email to pass this pre-flight check.
 */
export function WaitlistForm(): React.JSX.Element {
  const t = useTranslations("landing.waitlist");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<WaitlistState>({ status: "idle" });
  const statusId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const parsedInput = WaitlistSignupInputSchema.safeParse({ email, source: "web" });
    if (!parsedInput.success) {
      setState({ status: "invalid", message: t("status.invalid") });
      return;
    }

    setState({ status: "submitting" });

    let res: Response;
    try {
      res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Only the email leaves the browser; the BFF stamps `source`.
        body: JSON.stringify({ email: parsedInput.data.email }),
      });
    } catch {
      // Only a rejected fetch (offline, DNS) is a network error. Never log
      // the email or the raw error — it can carry the typed address.
      setState({ status: "network_error" });
      return;
    }

    const outcome = await classifyWaitlistResponse(res);
    switch (outcome.kind) {
      case "invalid":
        setState({ status: "invalid", message: t("status.invalid") });
        return;
      case "rate_limited":
        setState({ status: "rate_limited", retryAfterSec: outcome.retryAfterSec });
        return;
      default:
        setState({ status: outcome.kind });
    }
  }

  const isBusy = BUSY_STATES.has(state.status);
  const isDone = state.status === "joined" || state.status === "already_joined";

  return (
    <form className="waitlist" onSubmit={handleSubmit} noValidate>
      <label htmlFor="waitlist-email" className="sr-only">
        {t("emailLabel")}
      </label>
      <input
        id="waitlist-email"
        type="email"
        required
        placeholder={t("placeholder")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isBusy || isDone}
        aria-invalid={state.status === "invalid"}
        aria-describedby={statusId}
      />
      <button type="submit" disabled={isBusy || isDone}>
        {isBusy ? t("joining") : isDone ? t("joined") : t("join")}
      </button>
      <p id={statusId} role="status" aria-live="polite" className="waitlist-status">
        {state.status === "joined" && t("status.joined")}
        {state.status === "already_joined" && t("status.alreadyJoined")}
        {state.status === "invalid" && state.message}
        {state.status === "rate_limited" &&
          (state.retryAfterSec
            ? t("status.rateLimited", { seconds: state.retryAfterSec })
            : t("status.rateLimitedGeneric"))}
        {state.status === "server_error" && t("status.serverError")}
        {state.status === "unexpected" && t("status.unexpected")}
        {state.status === "network_error" && t("status.networkError")}
      </p>
    </form>
  );
}
