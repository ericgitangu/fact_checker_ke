import { useId, useState, type FormEvent } from "react";
import { WaitlistSignupInputSchema, WaitlistSignupResultSchema } from "@fact-checker-ke/core";

type WaitlistState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "joined" }
  | { status: "already_joined" }
  | { status: "invalid"; message: string }
  | { status: "rate_limited" }
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

    setState({ status: "submitting" });

    const apiUrl = import.meta.env.VITE_API_URL;

    try {
      const res = await fetch(`${apiUrl}/v1/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsedInput.data),
      });

      if (res.status === 400) {
        setState({ status: "invalid", message: "Enter a valid email address." });
        return;
      }
      if (res.status === 429) {
        setState({ status: "rate_limited" });
        return;
      }
      if (res.status !== 200 && res.status !== 201) {
        setState({ status: "network_error" });
        return;
      }

      const body: unknown = await res.json().catch(() => null);
      const parsedResult = WaitlistSignupResultSchema.safeParse(body);
      if (!parsedResult.success) {
        setState({ status: "network_error" });
        return;
      }

      setState({
        status: parsedResult.data.status === "joined" ? "joined" : "already_joined",
      });
    } catch {
      // Network failure, CORS rejection, etc. Never log the email or the
      // raw error here — it can carry the address the person just typed.
      setState({ status: "network_error" });
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
        {state.status === "rate_limited" && "Too many attempts — please try again in a moment."}
        {state.status === "network_error" && "Something went wrong — please try again."}
      </p>
    </form>
  );
}
