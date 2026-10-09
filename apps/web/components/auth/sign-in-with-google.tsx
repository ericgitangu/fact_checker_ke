"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

/**
 * Styled "Sign in with Google" button.
 *
 * A client leaf (it owns a click handler) but needs NO SessionProvider:
 * `next-auth/react`'s `signIn` only POSTs to the Auth.js route, it does not
 * read session context. `signIn("google", { callbackUrl })` hands off to the
 * Google consent screen and returns the user to `callbackUrl` afterward — this
 * is what preserves their place when they were gated mid-flow (the submit page
 * or an add-source action route through /signin?callbackUrl=…).
 *
 * Visually it reuses the design system: the base `.btn` geometry with a
 * neutral, theme-stable ground (Google's brand guidance wants the 4-colour "G"
 * on a light, high-contrast surface — not tinted with the site's brand green),
 * and the official four-colour mark as inline SVG so it needs no asset and
 * inherits no `currentColor`.
 */
export function SignInWithGoogle({
  callbackUrl = "/",
  label,
  className,
}: {
  /** Internal path to return to after auth. Validated upstream (signin page). */
  callbackUrl?: string;
  label: string;
  className?: string;
}): React.JSX.Element {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className={`btn google-signin-btn${className ? ` ${className}` : ""}`}
      disabled={pending}
      onClick={() => {
        setPending(true);
        // Full-page handoff to Google; no need to reset `pending` — the tab
        // navigates away. On an auth.js config error it rejects, so re-enable.
        void signIn("google", { callbackUrl }).catch(() => setPending(false));
      }}
    >
      <GoogleG />
      <span>{label}</span>
    </button>
  );
}

/** The official Google "G", four-colour, 18×18 — decorative (button has text). */
function GoogleG(): React.JSX.Element {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
