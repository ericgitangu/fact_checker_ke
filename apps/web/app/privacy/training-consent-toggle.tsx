"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

/**
 * ADR-0033 §C.4 / AT-0033-3 (ties to ADR-0021 AT-0021-6): the
 * data-as-training-moat consent must be a GRANULAR, SEVERABLE,
 * REVOCABLE control — never bundled into the act of submitting a check.
 *
 * Severability is structural here, not just copy: this toggle lives on
 * `/privacy`, nowhere near the submit flow (`components/submit/**`, not
 * touched by this change), takes no part in any submit request, and
 * defaults to OFF (DPA 2019 "freely given, specific, informed" consent
 * must never be pre-ticked). Flipping it never blocks or unlocks
 * submitting a claim.
 *
 * Honest scope note (no silent tech debt): this control persists the
 * visitor's choice to `localStorage` ONLY. The ADR's full requirement —
 * revocation routing to the DSAR pipeline and excluding that subject's
 * data from a future training run — is a `services/api` + `packages/db`
 * concern (DSAR export/erasure flow, `services/api/src/lib/retention.ts`)
 * that this change's file-ownership boundary explicitly excludes
 * (apps/web + packages/core/legal + packages/i18n only). So: the
 * severable/revocable UI contract is real and testable here; the
 * backend wiring that makes a revocation actually exclude past data from
 * training is NOT implemented by this pass and must not be read as done.
 * Tracked as an explicit follow-up, not buried.
 */

const STORAGE_KEY = "fck_training_consent_v1";

interface StoredConsent {
  granted: boolean;
  updatedAt: string;
}

// `useSyncExternalStore` requires `getSnapshot` to return a REFERENTIALLY
// STABLE value when nothing has changed (it compares with `Object.is` to
// decide whether to re-render) — returning a freshly-parsed object every
// call, even with identical contents, trips React's "getSnapshot should
// be cached" warning and an infinite re-render loop (confirmed
// empirically against this exact component: `Maximum update depth
// exceeded`). This cache keys on the raw stored string, parsing (and
// allocating a new object) only when the underlying storage actually
// changed.
let cachedRaw: string | null | undefined;
let cachedSnapshot: StoredConsent | null = null;

function readStoredConsent(): StoredConsent | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Inaccessible storage (private browsing, quota) — treat as "no
    // recorded choice" rather than throwing.
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
      typeof (parsed as StoredConsent).granted === "boolean" &&
      typeof (parsed as StoredConsent).updatedAt === "string"
        ? (parsed as StoredConsent)
        : null;
  } catch {
    // Corrupt stored data — treat as "no recorded choice" rather than
    // throwing.
    cachedSnapshot = null;
  }
  return cachedSnapshot;
}

function writeStoredConsent(granted: boolean): void {
  const next: StoredConsent = { granted, updatedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage write failure — nothing persists, but `notifyListeners`
    // below still re-syncs every mounted instance to the in-memory
    // attempt via `readStoredConsent()`'s own fallback (null -> OFF), so
    // the control never gets stuck showing a choice that didn't take.
  }
  notifyListeners();
}

// `useSyncExternalStore`'s subscribe/getSnapshot contract (React's own
// recommended pattern for reading an external store like `localStorage`)
// rather than `useState` + `useEffect`: avoids calling `setState`
// synchronously inside an effect (flagged by this repo's
// `react-hooks/set-state-in-effect` lint rule) AND avoids a
// hydration-mismatch flash, since React itself reconciles
// `getServerSnapshot()` (always `null` -> OFF, matching SSR) against the
// real client snapshot before paint, rather than this component manually
// deferring via a `hydrated` flag.
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): StoredConsent | null {
  return readStoredConsent();
}

function getServerSnapshot(): StoredConsent | null {
  return null;
}

export function TrainingConsentToggle(): React.JSX.Element {
  const t = useTranslations("legal");
  // Default OFF (no stored choice -> null -> false) — no pre-ticked
  // opt-in, per the DPA "freely given" requirement above.
  const consent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const granted = consent?.granted ?? false;

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    writeStoredConsent(event.target.checked);
  }

  return (
    <div className="legal-consent-toggle" aria-live="polite">
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={granted} onChange={handleChange} style={{ marginTop: 3 }} />
        <span>
          <span style={{ display: "block", fontWeight: 600, color: "var(--ink)" }}>
            {t("pages.privacy.consent.enableLabel")}
          </span>
          <span style={{ display: "block", fontSize: "0.86rem", color: "var(--ink-3)" }}>
            {t("pages.privacy.consent.severabilityNote")}
          </span>
        </span>
      </label>
      <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginTop: 8 }} role="status">
        {granted ? t("pages.privacy.consent.statusOn") : t("pages.privacy.consent.statusOff")}
      </p>
      <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginTop: 4 }}>
        {t("pages.privacy.consent.specialCategoryNote")}
      </p>
    </div>
  );
}
