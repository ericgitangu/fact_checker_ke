import { describe, expect, it } from "vitest";
import {
  MpesaBillingProvider,
  darajaTimestamp,
  ipInAllowlist,
  normalizeMsisdn,
  parseDarajaTransactionDate,
  type FetchLike,
} from "../lib/billing/mpesa.js";
import type { MpesaConfig } from "../config.js";

const CONFIGURED: MpesaConfig = {
  consumerKey: "ck_sandbox",
  consumerSecret: "cs_sandbox",
  shortcode: "174379",
  passkey: "pk_sandbox",
  env: "sandbox",
  callbackUrl: "https://api.example.test/v1/billing/webhook/mpesa",
  callbackIpAllowlist: ["196.201.214.0/24", "127.0.0.1"],
  amountKes: 200,
};

/** A fake fetch that answers the OAuth token call and the STK-push call. */
function fakeDaraja(opts: {
  token?: string;
  tokenStatus?: number;
  stk?: Record<string, unknown>;
  capture?: (url: string, init?: { body?: string; headers?: Record<string, string> }) => void;
}): FetchLike {
  return async (url, init) => {
    opts.capture?.(url, init);
    if (url.includes("/oauth/v1/generate")) {
      const status = opts.tokenStatus ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({ access_token: opts.token ?? "tok_123", expires_in: "3599" }),
        text: async () => "",
      };
    }
    if (url.includes("/mpesa/stkpush/v1/processrequest")) {
      return {
        ok: true,
        status: 200,
        json: async () => opts.stk ?? { ResponseCode: "0", CheckoutRequestID: "ws_CO_1", CustomerMessage: "Success." },
        text: async () => "",
      };
    }
    throw new Error(`unexpected URL ${url}`);
  };
}

describe("normalizeMsisdn (ported from moovn normalize_msisdn)", () => {
  it.each([
    ["0708123456", "254708123456"],
    ["+254708123456", "254708123456"],
    ["254708123456", "254708123456"],
    ["708123456", "254708123456"],
    ["0112345678", "254112345678"],
    ["112345678", "254112345678"],
  ])("normalises %s → %s", (input, expected) => {
    expect(normalizeMsisdn(input)).toBe(expected);
  });

  it.each([["255712345678"], ["12345"], [""], ["notaphone"], ["2547012345"] /* too short */])(
    "rejects non-Kenyan / malformed %s",
    (input) => {
      expect(normalizeMsisdn(input)).toBeNull();
    },
  );
});

describe("darajaTimestamp / parseDarajaTransactionDate", () => {
  it("formats YYYYMMDDHHmmss in UTC", () => {
    expect(darajaTimestamp(new Date("2026-10-05T07:08:09.000Z"))).toBe("20261005070809");
  });

  it("parses a Daraja TransactionDate (EAT) back to a UTC Date", () => {
    // 20261005100000 EAT (UTC+3) == 07:00:00Z.
    expect(parseDarajaTransactionDate(20261005100000)?.toISOString()).toBe("2026-10-05T07:00:00.000Z");
    expect(parseDarajaTransactionDate("notadate")).toBeNull();
  });
});

describe("ipInAllowlist (IPv4 exact + CIDR, fail-closed)", () => {
  it("matches exact and CIDR entries", () => {
    expect(ipInAllowlist("127.0.0.1", ["127.0.0.1"])).toBe(true);
    expect(ipInAllowlist("196.201.214.200", ["196.201.214.0/24"])).toBe(true);
    expect(ipInAllowlist("196.201.215.1", ["196.201.214.0/24"])).toBe(false);
  });
  it("fails closed on missing / malformed / empty allowlist", () => {
    expect(ipInAllowlist(undefined, ["127.0.0.1"])).toBe(false);
    expect(ipInAllowlist("127.0.0.1", [])).toBe(false);
    expect(ipInAllowlist("not-an-ip", ["0.0.0.0/0"])).toBe(false);
  });
});

describe("MpesaBillingProvider.createCheckout (STK push, HTTP mocked)", () => {
  it("is not_configured when credentials are unset", async () => {
    const unconfigured = new MpesaBillingProvider({ ...CONFIGURED, consumerKey: null });
    const r = await unconfigured.createCheckout({ tier: "premium", subjectRef: "dh", phone: "0708123456" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_configured");
  });

  it("is a provider_error for a non-Kenyan phone", async () => {
    const p = new MpesaBillingProvider(CONFIGURED, { httpFetch: fakeDaraja({}) });
    const r = await p.createCheckout({ tier: "premium", subjectRef: "dh", phone: "255712345678" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("provider_error");
  });

  it("builds the correct STK push and returns an stk_push result on ResponseCode 0", async () => {
    let stkBody: Record<string, unknown> | null = null;
    const p = new MpesaBillingProvider(CONFIGURED, {
      now: () => new Date("2026-10-05T07:08:09.000Z"),
      httpFetch: fakeDaraja({
        capture: (url, init) => {
          if (url.includes("processrequest") && init?.body) stkBody = JSON.parse(init.body) as Record<string, unknown>;
        },
      }),
    });
    const r = await p.createCheckout({ tier: "premium", subjectRef: "dh_subject", phone: "0708123456" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({ provider: "mpesa", kind: "stk_push", reference: "ws_CO_1" });
      expect(r.value.authorizationUrl).toBeUndefined();
    }
    // Request-build assertions: normalised MSISDN, correct amount, password = base64(shortcode+passkey+timestamp).
    expect(stkBody).toMatchObject({
      BusinessShortCode: "174379",
      Timestamp: "20261005070809",
      TransactionType: "CustomerPayBillOnline",
      Amount: 200,
      PartyA: "254708123456",
      PhoneNumber: "254708123456",
      CallBackURL: CONFIGURED.callbackUrl,
    });
    const expectedPassword = Buffer.from("174379pk_sandbox20261005070809", "utf8").toString("base64");
    expect((stkBody as unknown as { Password: string }).Password).toBe(expectedPassword);
  });

  it("is a provider_error when Daraja rejects (ResponseCode != 0)", async () => {
    const p = new MpesaBillingProvider(CONFIGURED, {
      httpFetch: fakeDaraja({ stk: { ResponseCode: "1", ResponseDescription: "Invalid Access Token" } }),
    });
    const r = await p.createCheckout({ tier: "premium", subjectRef: "dh", phone: "0708123456" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("provider_error");
  });

  it("is a provider_error when the OAuth token call fails", async () => {
    const p = new MpesaBillingProvider(CONFIGURED, { httpFetch: fakeDaraja({ tokenStatus: 401 }) });
    const r = await p.createCheckout({ tier: "premium", subjectRef: "dh", phone: "0708123456" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("provider_error");
  });
});

describe("MpesaBillingProvider.verifyWebhook (source-IP allowlist + fields, fail-closed)", () => {
  const p = new MpesaBillingProvider(CONFIGURED);
  const okBody = JSON.stringify({
    Body: { stkCallback: { CheckoutRequestID: "ws_CO_1", ResultCode: 0, ResultDesc: "ok" } },
  });

  it("accepts an allowlisted source IP + well-formed body", () => {
    expect(p.verifyWebhook({ rawBody: okBody, signature: undefined, sourceIp: "127.0.0.1" })).toBe(true);
  });
  it("rejects a source IP outside the allowlist", () => {
    expect(p.verifyWebhook({ rawBody: okBody, signature: undefined, sourceIp: "8.8.8.8" })).toBe(false);
  });
  it("rejects a malformed (non-stkCallback) body even from an allowlisted IP", () => {
    expect(p.verifyWebhook({ rawBody: '{"foo":1}', signature: undefined, sourceIp: "127.0.0.1" })).toBe(false);
  });
  it("fails closed when no allowlist is configured", () => {
    const noAllow = new MpesaBillingProvider({ ...CONFIGURED, callbackIpAllowlist: [] });
    expect(noAllow.verifyWebhook({ rawBody: okBody, signature: undefined, sourceIp: "127.0.0.1" })).toBe(false);
  });
  it("fails closed when unconfigured", () => {
    const unconfigured = new MpesaBillingProvider({ ...CONFIGURED, passkey: null });
    expect(unconfigured.verifyWebhook({ rawBody: okBody, signature: undefined, sourceIp: "127.0.0.1" })).toBe(false);
  });
});

describe("MpesaBillingProvider.parseEvent (stkCallback normalisation)", () => {
  const p = new MpesaBillingProvider(CONFIGURED, { now: () => new Date("2026-10-05T00:00:00.000Z") });

  it("grants premium on ResultCode 0 and derives the period from TransactionDate + 30d", () => {
    const body = JSON.stringify({
      Body: {
        stkCallback: {
          MerchantRequestID: "mr_1",
          CheckoutRequestID: "ws_CO_42",
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: 200 },
              { Name: "MpesaReceiptNumber", Value: "QABC123" },
              { Name: "TransactionDate", Value: 20261005100000 },
              { Name: "PhoneNumber", Value: 254708123456 },
            ],
          },
        },
      },
    });
    const parsed = p.parseEvent(body);
    expect(parsed).toMatchObject({
      eventId: "ws_CO_42",
      reference: "ws_CO_42",
      subjectRef: null,
      grantsPremium: true,
    });
    // 20261005100000 EAT == 07:00:00Z; +30d.
    expect(parsed?.currentPeriodEnd?.toISOString()).toBe("2026-11-04T07:00:00.000Z");
  });

  it("does NOT grant premium on a non-zero ResultCode (user cancelled / failed)", () => {
    const body = JSON.stringify({
      Body: { stkCallback: { CheckoutRequestID: "ws_CO_9", ResultCode: 1032, ResultDesc: "Request cancelled by user" } },
    });
    const parsed = p.parseEvent(body);
    expect(parsed?.grantsPremium).toBe(false);
    expect(parsed?.currentPeriodEnd).toBeNull();
  });

  it("returns null for a non-stkCallback body", () => {
    expect(p.parseEvent('{"Body":{}}')).toBeNull();
    expect(p.parseEvent("{not json")).toBeNull();
  });
});
