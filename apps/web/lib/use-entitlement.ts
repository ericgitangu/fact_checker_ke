"use client";

import { useEffect, useState } from "react";
import { EntitlementSchema, NO_ENTITLEMENT, type Entitlement } from "@fact-checker-ke/core";
import { getDeviceToken } from "./device-token";

/**
 * ADR-0012 §3 — the client's view of its own entitlement, fetched from the
 * server (the ONLY authority). The client never decides premium itself; it
 * asks `GET /api/entitlement` (the BFF proxy, which forwards the device
 * token to services/api) and treats the answer as opaque truth.
 *
 * Starts at the fail-safe `NO_ENTITLEMENT` (ads ON) and only ever UPGRADES
 * to ad-free after a successful server confirmation, so a slow/failed
 * fetch can never hide ads we were supposed to show (and inversely, a
 * premium reader seeing ads for one render until the fetch resolves is the
 * safe direction to be wrong in). Any failure leaves the fail-safe default.
 */
export function useEntitlement(fetchImpl: typeof fetch = fetch): Entitlement {
  const [entitlement, setEntitlement] = useState<Entitlement>(NO_ENTITLEMENT);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getDeviceToken(fetchImpl);
        const res = await fetchImpl("/api/entitlement", {
          headers: token ? { "X-Device-Token": token } : undefined,
        });
        if (!res.ok) return;
        const body: unknown = await res.json();
        const parsed = EntitlementSchema.safeParse(body);
        if (!cancelled && parsed.success) {
          setEntitlement(parsed.data);
        }
      } catch {
        // Network/parse failure — keep the fail-safe default (ads ON).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  return entitlement;
}
