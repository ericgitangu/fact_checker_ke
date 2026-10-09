import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Stagger } from "@fact-checker-ke/brand";
import { auth } from "../../auth";
import { SignInWithGoogle } from "../../components/auth/sign-in-with-google";

export const metadata: Metadata = {
  title: "Sign in — fact_checker_ke",
  description: "Sign in with Google to submit a claim or add a source.",
  // A sign-in utility page has no SEO value and should not be indexed.
  robots: { index: false, follow: false },
};

/**
 * Sign-in page with RETURN-TO routing.
 *
 * Reached when a logged-out reader hits a gated surface: the submit page
 * redirects here with `?callbackUrl=/submit`, and the add-source form routes
 * here with the current path on a 401. The Google button is wired to send the
 * user back to that `callbackUrl` after auth, so they never lose their place.
 *
 * Already-authenticated visitors are bounced straight to the target.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const { callbackUrl } = await searchParams;
  const target = sanitizeCallbackUrl(callbackUrl);

  const session = await auth();
  if (session) {
    redirect(target);
  }

  const t = await getTranslations("common");

  return (
    <div className="shell flex flex-col gap-12" style={{ maxWidth: 480, marginInline: "auto" }}>
      <Stagger className="flex flex-col gap-3" motion="rise" step={0.1} threshold={0.01}>
        <h1 className="font-expanded" style={{ fontSize: "clamp(1.75rem, 4vw, 2.5rem)" }}>
          {t("auth.heading")}
        </h1>
        <p style={{ maxWidth: "46ch", color: "var(--ink-2)" }}>{t("auth.lede")}</p>
      </Stagger>
      <SignInWithGoogle callbackUrl={target} label={t("auth.google")} />
    </div>
  );
}

/**
 * Open-redirect guard: only ever return to a same-origin path.
 *
 * A naive `startsWith("/") && !startsWith("//")` check is NOT enough — browsers
 * (WHATWG URL) treat "\" as "/" and strip tab/CR/LF, so `/\evil.com`,
 * `/\/evil.com` and `/%09/evil.com` (a tab after decoding) all normalise to an
 * off-origin `https://evil.com/`. This `redirect()` is our own (outside Auth.js,
 * which only backstops its own sign-in hop), so we must be airtight here:
 *   1) reject any backslash or C0/DEL control char up front (what browsers
 *      normalise away), then
 *   2) resolve against a sentinel origin and require the result to STAY on it —
 *      an absolute or protocol-relative URL lands on a different origin and is
 *      rejected; only a genuine same-origin path survives, returned normalised.
 */
export function sanitizeCallbackUrl(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value === "") return "/";
  // eslint-disable-next-line no-control-regex -- intentional: these are exactly
  // the chars browsers normalise ("\"->"/") or strip (tab/CR/LF) to escape origin.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const SENTINEL = "https://callback.invalid";
    const url = new URL(value, SENTINEL);
    if (url.origin !== SENTINEL) return "/";
    // Redirect-loop guard (Fable): a callbackUrl pointing back at /signin would
    // bounce the user to the sign-in page they just left (or loop on a failed
    // auth). Collapse any /signin[/...] target to home.
    if (url.pathname === "/signin" || url.pathname.startsWith("/signin/")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
