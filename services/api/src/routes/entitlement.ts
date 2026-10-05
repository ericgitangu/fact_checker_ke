import type { FastifyInstance, FastifyRequest } from "fastify";
import { CheckoutInputSchema, NO_ENTITLEMENT } from "@fact-checker-ke/core";
import { hashDeviceToken } from "../lib/device-token.js";
import type { EntitlementService } from "../lib/entitlement.js";
import type { EntitlementRepository } from "../repositories/types.js";
import type { BillingRegistry } from "../lib/billing/registry.js";

export interface EntitlementRouteDeps {
  entitlements: EntitlementRepository;
  entitlementService: EntitlementService;
  billing: BillingRegistry;
  /** apps/web origin, used to build the PSP checkout callback URL. */
  webBaseUrl?: string | null;
}

/**
 * Reads the raw device token from `X-Device-Token` and returns its hash —
 * the entitlement subject. The API only ever stores/compares the hash
 * (same discipline as `device_tokens`), so a leaked header never becomes a
 * stored credential. Returns null when the header is absent/blank.
 */
function deviceTokenHashFrom(request: FastifyRequest): string | null {
  const raw = request.headers["x-device-token"];
  const token = typeof raw === "string" ? raw.trim() : undefined;
  if (!token) return null;
  return hashDeviceToken(token);
}

export async function entitlementRoutes(app: FastifyInstance, deps: EntitlementRouteDeps): Promise<void> {
  /**
   * ADR-0012 §3: the server-authoritative entitlement read. The web
   * ad-free decision calls this (via its BFF proxy) and treats the result
   * as opaque truth — the client never decides premium from a date it was
   * handed. No device token ⇒ the fail-safe NO_ENTITLEMENT (ads ON).
   */
  app.get("/v1/entitlement", async (request, reply) => {
    const deviceTokenHash = deviceTokenHashFrom(request);
    if (!deviceTokenHash) {
      return reply.status(200).send(NO_ENTITLEMENT);
    }
    const entitlement = await deps.entitlementService.getForDevice(deviceTokenHash);
    // Private per-reader data — never let a shared CDN cache it.
    reply.header("cache-control", "private, no-store");
    return reply.status(200).send(entitlement);
  });

  /**
   * ADR-0012 §3: start a Premium checkout. FAIL-CLOSED STUB — the live PSP
   * `initialize` call is account-dependent and deliberately un-shipped
   * (the task forbids calling a live payments API). The subject is derived
   * server-side from `X-Device-Token`, never the body, so a caller can't
   * start a checkout that would grant premium to another identity.
   *
   * Status mapping:
   *   - no device token      → 401 (need an identity to attach premium to)
   *   - unknown/`manual` prov → 404
   *   - adapter not_configured→ 503 (owner hasn't added a PSP secret yet)
   *   - adapter not_implemented→ 501 (configured, but the live call is a stub)
   *   - adapter provider_error→ 502
   *   - ok                    → 200 { authorizationUrl, reference }
   */
  app.post("/v1/billing/checkout", async (request, reply) => {
    const deviceTokenHash = deviceTokenHashFrom(request);
    if (!deviceTokenHash) {
      return reply
        .status(401)
        .send({ error: "device_token_required", message: "A device token is required to start a checkout." });
    }

    const parsed = CheckoutInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    }

    const adapter = deps.billing.get(parsed.data.provider);
    if (!adapter) {
      return reply
        .status(404)
        .send({ error: "unknown_provider", message: `No checkout provider '${parsed.data.provider}'.` });
    }

    const callbackUrl = deps.webBaseUrl ? `${deps.webBaseUrl.replace(/\/$/, "")}/premium/thanks` : undefined;
    const result = await adapter.createCheckout({
      tier: parsed.data.tier,
      subjectRef: deviceTokenHash,
      email: parsed.data.email,
      phone: parsed.data.phone,
      callbackUrl,
    });

    if (result.ok) {
      // Record (provider, reference) → subject so the webhook/callback can
      // reconcile the payment back to THIS device even when the provider's
      // event doesn't echo the subject (M-Pesa's Daraja callback carries
      // only its CheckoutRequestID). Harmless-but-redundant for Paystack/
      // Stripe (which also echo the subject in metadata). Best-effort: a
      // failure here must not fail an already-initiated checkout — the
      // webhook simply falls back to the event's own subject, or no-ops.
      await deps.entitlements
        .putPendingSubject({
          provider: adapter.provider,
          reference: result.value.reference,
          deviceTokenHash,
        })
        .catch((err: unknown) => {
          request.log.warn({ err }, "failed to persist pending checkout subject (checkout still initiated)");
        });
      return reply.status(200).send(result.value);
    }
    const statusByKind: Record<typeof result.error.kind, number> = {
      not_configured: 503,
      not_implemented: 501,
      provider_error: 502,
    };
    return reply
      .status(statusByKind[result.error.kind])
      .send({ error: result.error.kind, message: result.error.message });
  });

  /**
   * ADR-0012 §3 / ADR-0017 inbox discipline: the PSP webhook. Ordering is
   * load-bearing and FAIL-CLOSED:
   *   1. resolve the adapter (404 for unknown/manual);
   *   2. verify the signature against the RAW bytes — missing/invalid ⇒ 401
   *      (an unconfigured adapter's verifier denies everything);
   *   3. parse → 400 if unparseable;
   *   4. record the event idempotently — a replay (firstTime=false) acks
   *      200 WITHOUT re-granting;
   *   5. if the event grants premium AND carries a subject, activate the
   *      entitlement (upsert on provider_ref). A subjectless grant is a
   *      safe no-op — we never guess whose premium to turn on.
   */
  app.post("/v1/billing/webhook/:provider", async (request, reply) => {
    const providerParam = (request.params as { provider: string }).provider;
    const adapter = deps.billing.get(providerParam);
    if (!adapter) {
      return reply.status(404).send({ error: "unknown_provider" });
    }

    const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? "";
    // adapter.signatureHeader is "" for M-Pesa (no HMAC header); indexing
    // headers with "" is simply undefined, which the adapter ignores — it
    // authenticates by source IP instead.
    const signature = adapter.signatureHeader ? request.headers[adapter.signatureHeader] : undefined;
    const signatureValue = typeof signature === "string" ? signature : undefined;

    if (!adapter.verifyWebhook({ rawBody, signature: signatureValue, sourceIp: request.ip })) {
      return reply.status(401).send({ error: "invalid_signature" });
    }

    const event = adapter.parseEvent(rawBody);
    if (!event) {
      return reply.status(400).send({ error: "unparseable_event" });
    }

    const { firstTime } = await deps.entitlements.recordBillingEvent({
      provider: adapter.provider,
      eventId: event.eventId,
      eventType: event.eventType,
      payload: JSON.parse(rawBody) as unknown,
    });
    if (!firstTime) {
      // Already processed (PSP retry) — ack without re-granting.
      return reply.status(200).send({ status: "duplicate_ignored" });
    }

    // Resolve the subject: the event's own (Paystack/Stripe echo it in
    // metadata) or, failing that, the pending-subject map keyed on
    // (provider, reference) written at checkout time (the ONLY source for
    // M-Pesa, whose callback echoes no subject). A still-null subject is a
    // safe no-op — we never guess whose premium to turn on.
    let subjectRef = event.subjectRef;
    if (event.grantsPremium && !subjectRef && event.reference) {
      subjectRef = await deps.entitlements.getPendingSubject({
        provider: adapter.provider,
        reference: event.reference,
      });
    }

    if (event.grantsPremium && subjectRef) {
      const activated = await deps.entitlements.activateDeviceEntitlement({
        deviceTokenHash: subjectRef,
        tier: "premium",
        provider: adapter.provider,
        providerRef: event.reference,
        currentPeriodEnd: event.currentPeriodEnd,
      });
      if (!activated.ok) {
        // The event was verified and recorded; the grant itself failed
        // (e.g. the device token was rotated away, failing the FK). Surface
        // it so the PSP retries rather than silently dropping a paid grant.
        request.log.error({ err: activated.error }, "entitlement activation failed after verified webhook");
        return reply.status(500).send({ error: "activation_failed" });
      }
      return reply.status(200).send({ status: "granted" });
    }

    return reply.status(200).send({ status: "acknowledged" });
  });
}
