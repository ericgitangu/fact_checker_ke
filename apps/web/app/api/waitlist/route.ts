import { NextResponse, after } from "next/server";
import { WaitlistSignupInputSchema } from "@fact-checker-ke/core";
import { verifyRecaptcha } from "../../../lib/recaptcha";
import { sendEmail } from "../../../lib/email/send";
import { renderEarlyAdopterAckEmail } from "../../../lib/email/early-adopter-ack";
import { SITE_URL } from "../../../lib/site";

/**
 * The only sender Resend allows WITHOUT a verified domain. Used for the
 * founder-notify (to the account owner) — a verified-domain sender is required
 * to email arbitrary adopters, so the adopter ack is gated on RESEND_VERIFIED_FROM.
 */
const FOUNDER_NOTIFY_FROM = "onboarding@resend.dev";
const FOUNDER_NOTIFY_TO = "developer.ericgitangu@gmail.com";

let adopterSkipLogged = false;

/**
 * HTML-escape untrusted values before interpolating into the founder-notify
 * email body (Fable hardening / defense-in-depth). `email` passes zod email
 * validation and `source` is server-stamped "web", so the practical injection
 * surface is small today — but an email-shaped value can still carry characters
 * an HTML renderer would interpret, and this email is read by a human in a
 * full HTML client. Escaping is unconditional rather than trusting the schema.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Fire-and-forget notifications for a brand-new signup. Runs in `after()` so it
 * never blocks or fails the signup response. Everything here fail-soft:
 *  - Founder-notify: always attempted (no-op if RESEND_API_KEY unset).
 *  - Adopter ack: only when RESEND_VERIFIED_FROM is set (resend.dev can't email
 *    arbitrary recipients). Skipped + logged once otherwise.
 */
async function notifyOnSignup(email: string, source: string): Promise<void> {
  const founder = await sendEmail({
    from: FOUNDER_NOTIFY_FROM,
    to: FOUNDER_NOTIFY_TO,
    subject: `New early-access signup: ${email}`,
    html: `<p>A new reader joined the fact_checker_ke waitlist.</p><p><strong>Email:</strong> ${esc(email)}<br><strong>Source:</strong> ${esc(source)}</p>`,
    text: `New early-access signup\n\nEmail: ${email}\nSource: ${source}\n`,
  });
  if (!founder.ok && founder.error !== "resend_disabled") {
    console.warn(`[waitlist] founder-notify failed: ${founder.error}`);
  }

  const verifiedFrom = process.env.RESEND_VERIFIED_FROM;
  if (!verifiedFrom) {
    if (!adopterSkipLogged) {
      adopterSkipLogged = true;
      console.info(
        "[waitlist] RESEND_VERIFIED_FROM unset — skipping the adopter acknowledgement " +
          "(resend.dev cannot email arbitrary recipients). Set a verified-domain sender to enable.",
      );
    }
    return;
  }

  const ack = renderEarlyAdopterAckEmail({
    siteUrl: SITE_URL,
    logoUrl: `${SITE_URL}/icon-512x512.png`,
  });
  const adopter = await sendEmail({
    from: verifiedFrom,
    to: email,
    subject: ack.subject,
    html: ack.html,
    text: ack.text,
    replyTo: FOUNDER_NOTIFY_TO,
  });
  if (!adopter.ok && adopter.error !== "resend_disabled") {
    console.warn(`[waitlist] adopter-ack failed: ${adopter.error}`);
  }
}

/**
 * BFF proxy for the waitlist (ADR-0015: web posts same-origin, no CORS, and
 * the API base URL stays out of the client bundle). The browser posts here;
 * this route validates against packages/core's WaitlistSignupInputSchema,
 * stamps `source: "web"` server-side (the origin is authoritative here, not
 * client-supplied), and forwards to services/api's `POST /v1/waitlist`.
 *
 * It passes the upstream status code and Retry-After header straight back
 * so the client's HTTP-semantics classifier (lib/waitlist-outcome.ts) sees
 * exactly what services/api returned: 201 joined | 200 already_joined | 400
 * invalid | 429 rate limited | 5xx server error.
 *
 * The original client IP is forwarded (x-forwarded-for / x-real-ip) so
 * services/api rate-limits per end-user, not per serverless instance —
 * without it every signup would share this function's egress IP and the
 * limiter (services/api/src/routes/waitlist.ts) would bucket all users
 * together.
 *
 * `interest` (ADR-0012 monetization signal, additive/optional) is passed
 * through unvalidated-but-schema-checked the same way `email` is: read off
 * the raw body, then only kept if it survives
 * `WaitlistSignupInputSchema.safeParse`. A missing or invalid value is
 * silently dropped (never a 400) so this stays a non-blocking signal, not a
 * new required field.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const raw: unknown = await request.json().catch(() => null);
  const email =
    typeof raw === "object" && raw !== null && "email" in raw
      ? (raw as { email: unknown }).email
      : undefined;
  const interest =
    typeof raw === "object" && raw !== null && "interest" in raw
      ? (raw as { interest: unknown }).interest
      : undefined;

  const parsed = WaitlistSignupInputSchema.safeParse({ email, source: "web", interest });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Bot gate (before forwarding — no auth on this public endpoint). Env-gated
  // no-op until RECAPTCHA_SECRET_KEY is set, then fails closed.
  const recaptcha = await verifyRecaptcha(request.headers.get("x-recaptcha-token") ?? "", {
    expectedAction: "waitlist_signup",
    minScore: 0.5,
  });
  if (!recaptcha.ok) {
    return NextResponse.json({ error: "recaptcha_failed" }, { status: 400 });
  }

  const apiBaseUrl = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");

  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/v1/waitlist`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
        ...(realIp ? { "x-real-ip": realIp } : {}),
      },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    });
  } catch {
    // Upstream unreachable (DNS, connection refused) — a retryable server
    // fault from the browser's point of view, never a 2xx.
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  const body: unknown = await res.json().catch(() => null);
  const response = NextResponse.json(body ?? {}, { status: res.status });
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) response.headers.set("retry-after", retryAfter);

  // 201 == a genuinely new signup (200 == already_joined, nothing new to
  // announce). Fire-and-forget the founder notify + gated adopter ack AFTER the
  // response: `after()` runs post-response, so a slow/failed Resend call can
  // never block or fail the signup the reader already succeeded at.
  if (res.status === 201) {
    const { email: signupEmail, source } = parsed.data;
    after(() => notifyOnSignup(signupEmail, source).catch(() => {}));
  }

  return response;
}
