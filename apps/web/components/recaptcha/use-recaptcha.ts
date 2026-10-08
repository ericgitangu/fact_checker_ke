"use client";

import { useCallback } from "react";

/**
 * Client hook that mints a reCAPTCHA v3 token for a given action, to be posted
 * to an API route that calls verifyRecaptcha() (lib/recaptcha.ts) server-side.
 *
 * SAFE NO-OP: returns null (never throws) when the site key is unset or the v3
 * script has not loaded yet (<RecaptchaProvider> absent, or still loading). The
 * caller treats null as "no token" and the server-side verifier, when the
 * secret is ALSO unset, treats that as the dev no-op; when the secret IS set, a
 * null/empty token fails closed. So the end-to-end behaviour stays coherent in
 * both the configured and unconfigured states.
 */

/**
 * Minimal surface of the global `grecaptcha` v3 object we actually call — typed
 * explicitly so there is no `any` reaching into window (owner rule).
 */
interface GrecaptchaV3 {
  ready(callback: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: GrecaptchaV3;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

export function useRecaptcha(): { execute: (action: string) => Promise<string | null> } {
  const execute = useCallback(async (action: string): Promise<string | null> => {
    if (!SITE_KEY) return null;

    const grecaptcha = typeof window !== "undefined" ? window.grecaptcha : undefined;
    if (!grecaptcha) return null;

    try {
      await new Promise<void>((resolve) => grecaptcha.ready(() => resolve()));
      return await grecaptcha.execute(SITE_KEY, { action });
    } catch {
      // Script present but execute() rejected (expired/removed) — degrade to
      // "no token" rather than surfacing an error into the submit flow.
      return null;
    }
  }, []);

  return { execute };
}
