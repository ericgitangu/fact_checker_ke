import { useId, useState, type FormEvent } from "react";
import { WaitlistSignupInputSchema } from "@fact-checker-ke/core";
import { resolveApiUrl } from "./config";
import { classifyWaitlistResponse } from "./waitlist-outcome";

type WaitlistState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "joined" }
  | { status: "already_joined" }
  | { status: "invalid"; message: string }
  | { status: "rate_limited"; retryAfterSec: number | null }
  | { status: "server_error" }
  | { status: "unexpected" }
  | { status: "misconfigured" }
  | { status: "network_error" };

const BUSY_STATES: ReadonlySet<WaitlistState["status"]> = new Set(["submitting"]);

/**
 * Joins the fact_checker_ke waitlist. Posts to services/api's
 * `POST /v1/waitlist` (contract: packages/core's WaitlistSignupInputSchema /
 * WaitlistSignupResultSchema) — 201 {status:"joined"} | 200
 * {status:"already_joined"} | 400 validation error | 429 rate limited.
 *
 * Only `.safeParse` is used against the core schemas (never `.parse` or a
 * direct `zod` import) so this stays correct regardless of which zod major
 * version packages/core is built against.
 */
export function WaitlistForm(): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<WaitlistState>({ status: "idle" });
  const statusId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const parsedInput = WaitlistSignupInputSchema.safeParse({ email, source: "site" });
    if (!parsedInput.success) {
      setState({
        status: "invalid",
        message: parsedInput.error.issues[0]?.message ?? "Enter a valid email address.",
      });
      return;
    }

    const config = resolveApiUrl(import.meta.env.VITE_API_URL);
    if (!config.ok) {
      // Deployment error, not a user or network problem — never send a
      // request to a relative/garbage URL.
      setState({ status: "misconfigured" });
      return;
    }

    setState({ status: "submitting" });

    let res: Response;
    try {
      res = await fetch(`${config.apiUrl}/v1/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsedInput.data),
      });
    } catch {
      // Only a rejected fetch (offline, DNS, CORS) is a network error. Never
      // log the email or the raw error — it can carry the typed address.
      setState({ status: "network_error" });
      return;
    }

    const outcome = await classifyWaitlistResponse(res);
    switch (outcome.kind) {
      case "invalid":
        setState({ status: "invalid", message: "Enter a valid email address." });
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
        Email address
      </label>
      <input
        id="waitlist-email"
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isBusy || isDone}
        aria-invalid={state.status === "invalid"}
        aria-describedby={statusId}
      />
      <button type="submit" disabled={isBusy || isDone}>
        {isBusy ? "Joining..." : isDone ? "You're on the list" : "Join"}
      </button>
      <p id={statusId} role="status" aria-live="polite" className="waitlist-status">
        {state.status === "joined" && "You're on the waitlist — thanks!"}
        {state.status === "already_joined" && "You're already on the waitlist."}
        {state.status === "invalid" && state.message}
        {state.status === "rate_limited" &&
          (state.retryAfterSec
            ? `Too many attempts — please try again in ${state.retryAfterSec} seconds.`
            : "Too many attempts — please try again in a moment.")}
        {state.status === "server_error" &&
          "The waitlist is temporarily unavailable — please try again shortly."}
        {state.status === "unexpected" &&
          "Something unexpected happened on our side — we couldn't add you. Please try again later."}
        {state.status === "misconfigured" &&
          "The waitlist isn't available right now. Please check back soon."}
        {state.status === "network_error" &&
          "We couldn't reach the server — check your connection and try again."}
      </p>
    </form>
  );
}
