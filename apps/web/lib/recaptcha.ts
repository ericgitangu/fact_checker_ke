/**
 * reCAPTCHA v3 — SERVER-side verification (ADR: bot protection for the
 * submission / add-a-source / early-adopter forms). Self-contained kit:
 * reCAPTCHA v3 is script-tag + fetch based, so this adds ZERO npm deps.
 *
 * Env-gated fail policy (the whole point of the kit — a missing key must never
 * break dev/test, but a configured-but-erroring verifier must fail CLOSED):
 *   - RECAPTCHA_SECRET_KEY unset  -> { ok: true,  reason: "recaptcha_disabled" }
 *        A deliberate dev/test NO-OP. Logged loudly once per process, never
 *        throws. This is the default until the reCAPTCHA keys exist.
 *   - Google call fails / times out -> { ok: false, reason: "verify_failed" }
 *        Fail-closed: the key IS set (protection is expected), so an
 *        unreachable/slow verifier is treated as "could not prove human",
 *        not "allow through".
 *   - token empty (key set)        -> { ok: false, reason: "missing_token" }
 *   - Google says success:false    -> { ok: false, reason: "verification_rejected" }
 *   - action mismatch (when expectedAction given) -> { ok: false, reason: "action_mismatch" }
 *   - score < minScore (default 0.5)              -> { ok: false, reason: "low_score" }
 *
 * The verifier runs server-side only (RECAPTCHA_SECRET_KEY is a secret and
 * must never reach the client bundle). Call it from a route handler after the
 * form posts the token obtained via useRecaptcha().execute(...).
 */

const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const DEFAULT_MIN_SCORE = 0.5;
const VERIFY_TIMEOUT_MS = 5000;

export interface VerifyRecaptchaOptions {
  /** If given, Google's returned `action` must equal this or verification fails. */
  readonly expectedAction?: string;
  /** Minimum v3 score to accept (0.0–1.0). Defaults to 0.5. */
  readonly minScore?: number;
}

export interface VerifyRecaptchaResult {
  readonly ok: boolean;
  /** The v3 score (0.0 bot … 1.0 human), or null when unavailable. */
  readonly score: number | null;
  /** The action name Google echoed back, or null when unavailable. */
  readonly action: string | null;
  /** Machine-readable outcome tag (see the fail-policy table above). */
  readonly reason?: string;
}

/**
 * The shape of https://www.google.com/recaptcha/api/siteverify's JSON body for
 * reCAPTCHA v3. `error-codes` uses the wire name; everything is optional on the
 * failure path, so it is narrowed by the type guard below rather than cast.
 */
interface SiteverifyResponse {
  readonly success: boolean;
  readonly score?: number;
  readonly action?: string;
  readonly challenge_ts?: string;
  readonly hostname?: string;
  readonly "error-codes"?: readonly string[];
}

function isSiteverifyResponse(value: unknown): value is SiteverifyResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof (value as { success: unknown }).success === "boolean"
  );
}

let disabledWarningEmitted = false;
function warnDisabledOnce(): void {
  if (disabledWarningEmitted) return;
  disabledWarningEmitted = true;
  // One loud, one-time note — never per request, never an error. Signals that
  // bot protection is OFF (expected in dev/test; a misconfiguration in prod).
  console.warn(
    "[recaptcha] RECAPTCHA_SECRET_KEY is unset — verification is disabled and " +
      "treated as a no-op (all tokens pass). Set RECAPTCHA_SECRET_KEY to enforce.",
  );
}

/**
 * Verify a reCAPTCHA v3 token server-side. Never throws — all failure modes are
 * returned as values (owner rule: errors are values).
 */
export async function verifyRecaptcha(
  token: string,
  opts: VerifyRecaptchaOptions = {},
): Promise<VerifyRecaptchaResult> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;

  // Dev/test no-op: no key configured -> allow through, warn once.
  if (!secret) {
    warnDisabledOnce();
    return { ok: true, score: null, action: null, reason: "recaptcha_disabled" };
  }

  // Key IS configured, so protection is expected: a missing token fails closed.
  if (!token) {
    return { ok: false, score: null, action: null, reason: "missing_token" };
  }

  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    // Network error or AbortController timeout. Fail closed — never leak the
    // token or raw error (the token is a short-lived credential).
    return { ok: false, score: null, action: null, reason: "verify_failed" };
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await res.json().catch(() => null);
  if (!isSiteverifyResponse(payload)) {
    return { ok: false, score: null, action: null, reason: "verify_failed" };
  }

  const score = typeof payload.score === "number" ? payload.score : null;
  const action = typeof payload.action === "string" ? payload.action : null;

  if (!payload.success) {
    return { ok: false, score, action, reason: "verification_rejected" };
  }

  if (opts.expectedAction !== undefined && action !== opts.expectedAction) {
    return { ok: false, score, action, reason: "action_mismatch" };
  }

  // v3 always returns a score on success; a missing one is itself suspicious.
  if (score === null || score < minScore) {
    return { ok: false, score, action, reason: "low_score" };
  }

  return { ok: true, score, action };
}
