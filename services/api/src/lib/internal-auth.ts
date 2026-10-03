import { Receiver } from "@upstash/qstash";

/**
 * Internal endpoints (`/internal/outbox/drain`, `/internal/events/
 * submission-advanced`) are called by QStash (scheduled sweep / hop
 * callback), never by a browser, so they're protected by QStash's
 * signature verification instead of a session (ADR-0017 §4, ADR-0015
 * "public ingress plus signature verification" pattern).
 *
 * The route depends on this narrow `verify(signature, body, url)`
 * contract rather than the `Receiver` class directly, so tests can
 * inject a deterministic verifier and assert the ROUTE's behaviour
 * (missing/invalid signature -> 401; valid -> handler runs) without
 * reproducing QStash's internal JWT format — see
 * services/api/src/__tests__/internal-routes.test.ts and the ADR-0017
 * implementation notes for why real QStash delivery can't be exercised
 * from localhost.
 */
export interface SignatureVerifier {
  verify(input: { signature: string | undefined; body: string; url: string }): Promise<boolean>;
}

export class QStashSignatureVerifier implements SignatureVerifier {
  private readonly receiver: Receiver;

  constructor(currentSigningKey: string, nextSigningKey: string) {
    this.receiver = new Receiver({ currentSigningKey, nextSigningKey });
  }

  async verify(input: { signature: string | undefined; body: string; url: string }): Promise<boolean> {
    if (!input.signature) return false;
    try {
      return await this.receiver.verify({ signature: input.signature, body: input.body, url: input.url });
    } catch {
      return false;
    }
  }
}

/**
 * Rejects everything. Used as the safe default when signing keys are
 * unset — an internal endpoint with no configured verifier must fail
 * closed, never fall open to "no auth configured, allow all" (the
 * dev-only simulator route is the deliberate, explicitly-gated
 * exception — see routes/internal.ts).
 */
export class DenyAllSignatureVerifier implements SignatureVerifier {
  async verify(): Promise<boolean> {
    return false;
  }
}
