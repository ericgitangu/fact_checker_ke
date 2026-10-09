import "server-only";

/**
 * Minimal Resend transport over the REST API via `fetch` — NO npm dependency
 * (same dependency-free posture as lib/recaptcha.ts). The `server-only` import
 * makes importing this from a Client Component a build error: RESEND_API_KEY is
 * a secret and must never reach the client bundle.
 *
 * Fail-soft contract (owner rule: errors are values, never throw):
 *   - RESEND_API_KEY unset        -> { ok: false, error: "resend_disabled" }
 *        Deliberate no-op (dev/test, or prod before the key exists). Warned
 *        once per process, never per call.
 *   - network error / timeout     -> { ok: false, error: "request_failed" }
 *   - Resend non-2xx              -> { ok: false, error: "http_<status>" }
 *   - success                     -> { ok: true, id }
 *
 * The caller decides whether a failure matters. The waitlist founder-notify
 * fires-and-forgets this (a mail failure must never fail a signup), so every
 * path here resolves — it must not reject.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 5000;

export interface SendEmailInput {
  /** Verified-domain or resend.dev sender, e.g. "onboarding@resend.dev". */
  readonly from: string;
  readonly to: string | readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Optional reply-to (e.g. the founder address for the adopter ack). */
  readonly replyTo?: string;
}

export interface SendEmailResult {
  readonly ok: boolean;
  readonly id?: string;
  /** Machine-readable failure tag (see the fail-soft table above). */
  readonly error?: string;
}

let disabledWarningEmitted = false;
function warnDisabledOnce(): void {
  if (disabledWarningEmitted) return;
  disabledWarningEmitted = true;
  console.warn(
    "[email] RESEND_API_KEY is unset — email sending is disabled (no-op). " +
      "Set RESEND_API_KEY to enable transactional mail.",
  );
}

/** Narrow the Resend success body ({ id: string }) without a cast. */
function extractId(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = (value as { id: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/**
 * Send one transactional email through Resend. Never throws — all failure modes
 * are returned as values so a fire-and-forget caller can simply `.catch()` the
 * (impossible) rejection and otherwise ignore the result.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    warnDisabledOnce();
    return { ok: false, error: "resend_disabled" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    // Network error or AbortController timeout. Never surface the raw error
    // (it can carry the recipient address).
    return { ok: false, error: "request_failed" };
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    return { ok: false, error: `http_${res.status}` };
  }

  const payload: unknown = await res.json().catch(() => null);
  return { ok: true, id: extractId(payload) };
}
