"use client";

import { useSyncExternalStore } from "react";
import { useServerConsentRegion } from "../components/ads/consent-region-provider";

/**
 * ADR-0012 §4 — a lightweight consent gate (CMP) for EEA/UK. The brief:
 * "do not load ads/personalization without consent". Mirrors the proven
 * `useSyncExternalStore` + localStorage pattern already used for the
 * training-consent toggle (app/privacy/training-consent-toggle.tsx) —
 * referentially-stable snapshot cache, SSR-safe (`getServerSnapshot`
 * returns null), try/catch around every storage access.
 *
 * SCOPE / HONEST GAP (no silent tech debt): region detection here is a
 * best-effort CLIENT heuristic (IANA timezone). It is deliberately
 * conservative — it treats European timezones as "consent required" and
 * errs toward SHOWING the banner, never toward loading ads for someone who
 * should have been asked. The AUTHORITATIVE signal is server/CDN geo-IP
 * (e.g. a Vercel `x-vercel-ip-country` header passed to the client), which
 * this scaffold does NOT wire up — flagged as the real fix, not buried.
 * Since ads ship inert (no AdSense client id until the owner adds one),
 * this gate has no live effect yet; it is the correct seam for when they do.
 */

// Not a secret — a localStorage key NAME (same pattern as lib/device-token.ts's
// STORAGE_KEY). gitleaks' generic-api-key rule flags the `*_KEY = "<high-entropy>"`
// shape, so annotate this false positive inline rather than widening config.
const STORAGE_KEY = "fck_ads_consent_v1"; // gitleaks:allow

export type ConsentChoice = "granted" | "denied";

interface StoredConsent {
  choice: ConsentChoice;
  updatedAt: string;
}

let cachedRaw: string | null | undefined;
let cachedSnapshot: StoredConsent | null = null;

function readStored(): StoredConsent | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedSnapshot;
  cachedRaw = raw;
  if (!raw) {
    cachedSnapshot = null;
    return cachedSnapshot;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    cachedSnapshot =
      typeof parsed === "object" &&
      parsed !== null &&
      ((parsed as StoredConsent).choice === "granted" || (parsed as StoredConsent).choice === "denied") &&
      typeof (parsed as StoredConsent).updatedAt === "string"
        ? (parsed as StoredConsent)
        : null;
  } catch {
    cachedSnapshot = null;
  }
  return cachedSnapshot;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): StoredConsent | null {
  return readStored();
}

function getServerSnapshot(): StoredConsent | null {
  return null;
}

export function setConsent(choice: ConsentChoice): void {
  const next: StoredConsent = { choice, updatedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode/quota) — the in-memory listeners still
    // re-sync to readStored()'s fallback (null ⇒ undecided), so the gate
    // never gets stuck showing a choice that didn't persist.
  }
  notify();
}

/**
 * Best-effort "is this reader in a jurisdiction that requires prior
 * consent (EEA/UK)?" heuristic. Conservative by construction (see the
 * scope note above). Returns false during SSR so the server never assumes
 * a region.
 *
 * NOTE (ADR-0012 §4, monetization v2): this is now only the FALLBACK. The
 * authoritative decision is the server geo-IP flag threaded through
 * `ConsentRegionProvider` (lib/consent-region.ts) and consumed by
 * `useAdsConsent` below; this client heuristic is used only when the server
 * supplied no signal (local dev / non-Vercel host).
 */
export function regionRequiresConsent(): boolean {
  if (typeof Intl === "undefined") return false;
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return false;
  }
  // European timezones (covers the EEA) plus the UK/Ireland and the
  // European Atlantic zones. Not exhaustive — the server geo header is the
  // real signal; this only decides whether to SHOW the banner.
  return (
    tz.startsWith("Europe/") ||
    tz === "Atlantic/Canary" ||
    tz === "Atlantic/Madeira" ||
    tz === "Atlantic/Faroe" ||
    tz === "Atlantic/Reykjavik"
  );
}

export interface AdsConsentState {
  /** Whether a consent choice is required before loading ads for this reader. */
  required: boolean;
  /** The stored choice, or undefined when undecided. */
  choice: ConsentChoice | undefined;
  /** True when ads MAY load: either consent isn't required, or it was granted. */
  satisfied: boolean;
  /** True when the banner should be shown: consent required AND not yet decided. */
  showBanner: boolean;
}

/**
 * The hook the AdSlot + ConsentBanner share. `required` is the AUTHORITATIVE
 * server geo-IP decision (`x-vercel-ip-country`, threaded via
 * `ConsentRegionProvider`) when the server supplied one; only when it didn't
 * (null — local dev / non-Vercel host) does it fall back to the legacy
 * client timezone heuristic, so geo availability never regresses the gate.
 * The stored choice is read via the external store so every mounted consumer
 * stays in sync after a grant/deny.
 */
export function useAdsConsent(): AdsConsentState {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const serverRequired = useServerConsentRegion();
  const required = serverRequired ?? regionRequiresConsent();
  const choice = stored?.choice;
  const satisfied = !required || choice === "granted";
  const showBanner = required && choice === undefined;
  return { required, choice, satisfied, showBanner };
}
