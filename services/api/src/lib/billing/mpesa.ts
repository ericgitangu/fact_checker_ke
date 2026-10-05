import type { MpesaConfig } from "../../config.js";
import { premiumPeriodEnd } from "./premium.js";
import type {
  BillingProviderAdapter,
  CreateCheckoutInput,
  CreateCheckoutResult,
  NormalizedBillingEvent,
} from "./types.js";

/**
 * ADR-0012 §3 (monetization v2) — the M-Pesa adapter (Safaricom Daraja C2B
 * STK push). Ported from the moovn-backend Daraja integration PATTERN (not
 * its secret values): OAuth client-credentials token → STK push →
 * `Body.stkCallback` reconciliation. Every secret is read from
 * fact_checker_ke's OWN env via `MpesaConfig`; nothing is hardcoded.
 *
 * FAIL-CLOSED (task constraint — safe to deploy with NO keys set):
 *   - unconfigured (any of consumer key/secret, shortcode, passkey unset)
 *     ⇒ `configured=false` ⇒ checkout returns `not_configured` (503) and
 *     `verifyWebhook` denies every callback.
 *   - `MPESA_ENV` defaults to `sandbox`, so a half-configured deploy can
 *     only ever reach `https://sandbox.safaricom.co.ke`, never live.
 *
 * SANDBOX-ONLY: this talks to the Daraja SANDBOX base URL unless
 * `MPESA_ENV=production` is explicitly set. The task forbids calling a live
 * payment endpoint; the owner flips `MPESA_ENV` only when going live.
 *
 * CALLBACK AUTHENTICITY — Daraja does NOT sign its callback with an HMAC
 * header (unlike Paystack/Stripe). moovn authenticates it at the edge
 * (nginx source-IP allowlist of Safaricom's ranges) plus app-layer
 * result-field + dedup checks. We mirror that: `verifyWebhook` fails closed
 * unless `MPESA_CALLBACK_IP_ALLOWLIST` is set AND the request's source IP is
 * in it AND the body is a well-formed `stkCallback`. The owner MUST also
 * keep an edge allowlist — documented, not assumed.
 */

/** Minimal `fetch` surface the adapter needs — global `fetch` satisfies it; tests inject a fake (no real network). */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface MpesaAdapterDeps {
  /** Safaricom callback source-IP allowlist (IPv4 exact or CIDR). Empty ⇒ callbacks fail closed. */
  callbackIpAllowlist?: string[];
  /** The Premium price in whole KES. The STK push amount. */
  amountKes?: number;
  /** Injected for tests (no real network / clock). */
  httpFetch?: FetchLike;
  now?: () => Date;
}

const SANDBOX_BASE = "https://sandbox.safaricom.co.ke";
const PRODUCTION_BASE = "https://api.safaricom.co.ke";

/**
 * Normalises a user-entered phone to a Safaricom MSISDN `2547XXXXXXXX` /
 * `2541XXXXXXXX`, or null for anything non-Kenyan. Ported from moovn's
 * `normalize_msisdn` (the robust variant). Exported for unit testing.
 */
export function normalizeMsisdn(phone: string | undefined | null): string | null {
  const digits = String(phone ?? "").replace(/\D+/g, "");
  if (digits.startsWith("254")) return digits.length === 12 ? digits : null;
  if (digits.startsWith("255")) return null; // Tanzania — wrong rail.
  if (digits.length === 10 && digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9 && (digits[0] === "7" || digits[0] === "1")) return `254${digits}`;
  return null;
}

/** `YYYYMMDDHHmmss` in UTC — the Daraja timestamp format; the STK password hashes the SAME value. */
export function darajaTimestamp(date: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  );
}

/** Parses a Daraja `TransactionDate` (`YYYYMMDDHHmmss`, EAT) into a Date, or null. */
export function parseDarajaTransactionDate(value: unknown): Date | null {
  const s = typeof value === "number" || typeof value === "string" ? String(value) : "";
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  // EAT is UTC+3, with no DST. Treat the wall-clock stamp as EAT.
  const [, y, mo, d, h, mi, se] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 3, Number(mi), Number(se));
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Reads a `CallbackMetadata.Item` value by its `Name` (safer than moovn's positional access). */
function metadataItem(items: unknown, name: string): unknown {
  if (!Array.isArray(items)) return undefined;
  for (const item of items) {
    if (item && typeof item === "object" && (item as { Name?: unknown }).Name === name) {
      return (item as { Value?: unknown }).Value;
    }
  }
  return undefined;
}

/** IPv4 exact-or-CIDR membership. Non-IPv4 / malformed inputs never match (fail closed). */
export function ipInAllowlist(ip: string | undefined, allowlist: string[]): boolean {
  if (!ip) return false;
  const toInt = (addr: string): number | null => {
    const parts = addr.split(".");
    if (parts.length !== 4) return null;
    let acc = 0;
    for (const part of parts) {
      if (!/^\d{1,3}$/.test(part)) return null;
      const n = Number(part);
      if (n > 255) return null;
      acc = acc * 256 + n;
    }
    return acc >>> 0;
  };
  const ipInt = toInt(ip);
  if (ipInt === null) return false;
  for (const entry of allowlist) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const slash = trimmed.indexOf("/");
    if (slash === -1) {
      if (toInt(trimmed) === ipInt) return true;
      continue;
    }
    const base = toInt(trimmed.slice(0, slash));
    const bits = Number(trimmed.slice(slash + 1));
    if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((ipInt & mask) === (base & mask)) return true;
  }
  return false;
}

export class MpesaBillingProvider implements BillingProviderAdapter {
  readonly provider = "mpesa" as const;
  // Daraja has no HMAC webhook header; authenticity is source-IP + fields.
  readonly signatureHeader = "";
  readonly configured: boolean;

  private readonly baseUrl: string;
  private readonly allowlist: string[];
  private readonly amountKes: number;
  private readonly httpFetch: FetchLike;
  private readonly now: () => Date;

  constructor(
    private readonly cfg: MpesaConfig,
    deps: MpesaAdapterDeps = {},
  ) {
    this.configured = Boolean(cfg.consumerKey && cfg.consumerSecret && cfg.shortcode && cfg.passkey);
    this.baseUrl = cfg.env === "production" ? PRODUCTION_BASE : SANDBOX_BASE;
    // The allowlist + amount live on the config block; `deps` only overrides
    // them for tests.
    this.allowlist = deps.callbackIpAllowlist ?? cfg.callbackIpAllowlist ?? [];
    // Default to 1 KES — the smallest sandbox-safe amount; the owner sets the
    // real Premium price via MPESA_C2B_AMOUNT (see config.ts / the report).
    const amount = deps.amountKes ?? cfg.amountKes ?? 0;
    this.amountKes = amount > 0 ? amount : 1;
    this.httpFetch = deps.httpFetch ?? ((globalThis as { fetch: FetchLike }).fetch?.bind(globalThis) as FetchLike);
    this.now = deps.now ?? (() => new Date());
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    if (!this.configured || !this.cfg.consumerKey || !this.cfg.consumerSecret || !this.cfg.shortcode || !this.cfg.passkey) {
      return {
        ok: false,
        error: {
          kind: "not_configured",
          message:
            "M-Pesa is not configured (set MPESA_C2B_CONSUMER_KEY/SECRET, MPESA_C2B_SHORTCODE, MPESA_C2B_ONLINE_PASSKEY). Checkout is disabled until the owner adds the Daraja sandbox credentials.",
        },
      };
    }
    if (!this.cfg.callbackUrl) {
      return {
        ok: false,
        error: {
          kind: "not_configured",
          message: "M-Pesa callback URL is unset (MPESA_C2B_CALLBACK_URL); refusing to push a payment we can't reconcile.",
        },
      };
    }
    const msisdn = normalizeMsisdn(input.phone);
    if (!msisdn) {
      return {
        ok: false,
        error: {
          kind: "provider_error",
          message: "A valid Kenyan M-Pesa phone number (2547XXXXXXXX) is required for an STK push.",
        },
      };
    }

    let accessToken: string;
    try {
      accessToken = await this.fetchAccessToken();
    } catch (err) {
      return { ok: false, error: { kind: "provider_error", message: `M-Pesa OAuth failed: ${errMsg(err)}` } };
    }

    const timestamp = darajaTimestamp(this.now());
    const password = Buffer.from(`${this.cfg.shortcode}${this.cfg.passkey}${timestamp}`, "utf8").toString("base64");
    const body = {
      BusinessShortCode: this.cfg.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: this.amountKes,
      PartyA: msisdn,
      PartyB: this.cfg.shortcode,
      PhoneNumber: msisdn,
      CallBackURL: this.cfg.callbackUrl,
      // AccountReference is <=12 chars and NOT the subject (the device-token
      // subject can't fit); the subject→reference map is persisted by the
      // route via the returned CheckoutRequestID. A stable product label.
      AccountReference: "FactCheckKE",
      TransactionDesc: `Premium ${input.tier}`,
    };

    let json: Record<string, unknown>;
    try {
      const res = await this.httpFetch(`${this.baseUrl}/mpesa/stkpush/v1/processrequest`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      json = ((await res.json()) ?? {}) as Record<string, unknown>;
    } catch (err) {
      return { ok: false, error: { kind: "provider_error", message: `M-Pesa STK push failed: ${errMsg(err)}` } };
    }

    // Daraja returns HTTP 200 for BOTH accept and reject; success is keyed on
    // ResponseCode === "0", never the HTTP status (moovn's lesson).
    const responseCode = typeof json.ResponseCode === "string" || typeof json.ResponseCode === "number" ? String(json.ResponseCode) : null;
    const checkoutRequestId = typeof json.CheckoutRequestID === "string" ? json.CheckoutRequestID : null;
    if (responseCode !== "0" || !checkoutRequestId) {
      const detail =
        (typeof json.errorMessage === "string" && json.errorMessage) ||
        (typeof json.ResponseDescription === "string" && json.ResponseDescription) ||
        (typeof json.CustomerMessage === "string" && json.CustomerMessage) ||
        "unknown Daraja error";
      return { ok: false, error: { kind: "provider_error", message: `M-Pesa STK push rejected: ${detail}` } };
    }
    const customerMessage = typeof json.CustomerMessage === "string" ? json.CustomerMessage : undefined;

    return {
      ok: true,
      value: {
        provider: "mpesa",
        kind: "stk_push",
        // The reconcile anchor: the callback echoes this and nothing else
        // that identifies the payment, so it is both the dedup event id and
        // the pending-subject lookup key (see routes/entitlement.ts).
        reference: checkoutRequestId,
        customerMessage,
      },
    };
  }

  private async fetchAccessToken(): Promise<string> {
    const credentials = Buffer.from(`${this.cfg.consumerKey}:${this.cfg.consumerSecret}`, "utf8").toString("base64");
    const res = await this.httpFetch(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      method: "GET",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
    const json = ((await res.json()) ?? {}) as Record<string, unknown>;
    const token = typeof json.access_token === "string" ? json.access_token : null;
    if (!token) throw new Error("no access_token in Daraja response");
    return token;
  }

  verifyWebhook(input: { rawBody: string; signature: string | undefined; sourceIp?: string | undefined }): boolean {
    // Fail closed: unconfigured, OR no edge allowlist configured, OR a source
    // IP outside it. The task requires it be safe to deploy with no keys set
    // — an unset allowlist means "reject every callback", never "allow all".
    if (!this.configured) return false;
    if (this.allowlist.length === 0) return false;
    if (!ipInAllowlist(input.sourceIp, this.allowlist)) return false;
    // Result-field validation: it must be a well-formed stkCallback with a
    // numeric ResultCode. A body that isn't shaped like a Daraja callback is
    // rejected before it ever reaches parseEvent.
    const stk = this.readStkCallback(input.rawBody);
    return stk !== null && typeof stk.ResultCode === "number";
  }

  private readStkCallback(rawBody: string): Record<string, unknown> | null {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (!json || typeof json !== "object") return null;
    const body = (json as { Body?: unknown }).Body;
    if (!body || typeof body !== "object") return null;
    const stk = (body as { stkCallback?: unknown }).stkCallback;
    if (!stk || typeof stk !== "object") return null;
    return stk as Record<string, unknown>;
  }

  parseEvent(rawBody: string): NormalizedBillingEvent | null {
    const stk = this.readStkCallback(rawBody);
    if (!stk) return null;
    const checkoutRequestId = typeof stk.CheckoutRequestID === "string" ? stk.CheckoutRequestID : null;
    if (!checkoutRequestId) return null;
    const resultCode = typeof stk.ResultCode === "number" ? stk.ResultCode : null;
    if (resultCode === null) return null;

    const grantsPremium = resultCode === 0;
    let currentPeriodEnd: Date | null = null;
    if (grantsPremium) {
      const meta = (stk.CallbackMetadata as { Item?: unknown } | undefined)?.Item;
      const txnDate = parseDarajaTransactionDate(metadataItem(meta, "TransactionDate"));
      // A one-off pass: period = payment time (or now, if Daraja omitted the
      // date on a success — defensive) + PREMIUM_PERIOD_DAYS.
      currentPeriodEnd = premiumPeriodEnd(txnDate ?? this.now());
    }

    return {
      // The CheckoutRequestID is the (provider, eventId) dedup key — a
      // Daraja retry of the same callback is deduped in billing_events.
      eventId: checkoutRequestId,
      eventType: `mpesa.stk.result.${resultCode}`,
      reference: checkoutRequestId,
      // M-Pesa can't echo the subject; the route resolves it from the
      // pending-subject map keyed on (mpesa, reference).
      subjectRef: null,
      grantsPremium,
      currentPeriodEnd,
    };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
