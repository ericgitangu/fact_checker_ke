import type { Metadata } from "next";
import { Archivo, Bricolage_Grotesque, Newsreader } from "next/font/google";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { SerwistProvider } from "@serwist/turbopack/react";
import { AppFooter, AppHeader } from "../components/site-chrome";
import { GoogleAnalytics } from "../components/analytics/google-analytics";
import { RecaptchaProvider } from "../components/recaptcha/recaptcha-provider";
import { ConsentBanner } from "../components/ads/consent-banner";
import { ConsentRegionProvider } from "../components/ads/consent-region-provider";
import { countryRequiresConsent } from "../lib/consent-region";
import { SITE_URL } from "../lib/site";
import "./globals.css";

// Three families, matching apps/site's pairing exactly: Archivo (body/UI
// sans), Bricolage Grotesque (display — headings, the wordmark's
// typographic register), and Newsreader (serif, reserved for the human
// claim under examination). Self-hosted via next/font/google (display:
// swap, CSS variable binding, no external <link>, zero layout-shift
// webfont) — see packages/brand/README.md's "Font parity" section for why
// apps/site loads the same families via a <link> instead.
//
// THE DRIFT THIS FIXES: apps/web previously had NO Bricolage Grotesque at
// all, and faked a "display" look by requesting Archivo's `wdth` (width)
// axis at `font-stretch: 125%` on headings — a different typeface
// entirely from apps/site's actual Bricolage Grotesque headings, on top of
// an old plain "fc" tile with no wordmark/flag. Both are fixed together
// here: the wordmark now comes from @fact-checker-ke/brand (see
// components/site-chrome.tsx), and headings now render in the real
// Bricolage Grotesque, matching apps/site. Archivo itself is kept, plain
// (no `axes`/`wdth`), as the body/UI sans — removing it entirely would
// have been removing a font apps/web legitimately still uses for body
// copy, not just the drifted display hack.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal"],
  display: "swap",
});

const bricolageGrotesque = Bricolage_Grotesque({
  variable: "--font-bricolage-grotesque",
  subsets: ["latin"],
  weight: "variable",
  style: ["normal"],
  display: "swap",
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500"],
  display: "swap",
});

const OG_DESCRIPTION =
  "Kenya's loudest claims, checked against the evidence — cited sources, confidence-weighted assessments, human-audited, in English, Swahili and Sheng.";

// OG/SEO/PWA metadata for the whole app, ported from the retired apps/site
// (index.html) into Next's Metadata API when apps/site was folded in
// (ADR-0010/0015 amendments). Pages that set their own `title`/`description`
// (feed, methodology, submit, …) override the defaults; the social cards,
// icons and canonical base below apply everywhere unless a page overrides
// them. The shareable OG images live in app/opengraph-image.png and
// public/ (og-image.png / og-image-square.png).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "fact_checker_ke — Kenya's claims, checked against the evidence",
    template: "%s",
  },
  description: OG_DESCRIPTION,
  applicationName: "fact_checker_ke",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "fact_checker_ke",
    locale: "en_KE",
    url: SITE_URL,
    title: "fact_checker_ke — Kenya's claims, checked against the evidence",
    description: OG_DESCRIPTION,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "fact_checker_ke — Kenya's claims, checked against the evidence",
      },
      {
        // Square fallback: Telegram, Discord and some messengers prefer a
        // near-1:1 image for link-preview thumbnails.
        url: "/og-image-square.png",
        width: 1200,
        height: 1200,
        alt: "fact_checker_ke — Kenya's claims, checked against the evidence",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "fact_checker_ke — Kenya's claims, checked against the evidence",
    description: OG_DESCRIPTION,
    images: ["/og-image.png"],
  },
};

// Pre-paint theme resolution — mirrors apps/site/src/index.html. Runs
// synchronously at the top of <body>, BEFORE the browser paints the styled
// tree, so a dark-mode visitor never sees a light flash. Reads the persisted
// choice (localStorage "fck-theme", the same key brand's useTheme writes)
// and falls back to prefers-color-scheme; brand's useTheme takes over on
// hydration. Kept to one expression and wrapped in try/catch so blocked
// storage can't throw before React mounts.
const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem("fck-theme");var t=(s==="light"||s==="dark")?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const messages = await getMessages();

  // ADR-0012 §4 (monetization v2): the AUTHORITATIVE consent-region decision,
  // made server-side from the platform geo header rather than a client
  // timezone guess. Vercel sets `x-vercel-ip-country` on every request; a
  // null result (local dev / non-Vercel host / unresolved geo) tells the
  // client hook to fall back to its legacy heuristic. Reading headers() opts
  // this layout into dynamic rendering, which is already the case (it reads
  // the locale cookie via next-intl).
  const country = (await headers()).get("x-vercel-ip-country");
  const serverRequiresConsent = countryRequiresConsent(country);

  return (
    <html
      lang={locale}
      // The pre-paint script below sets data-theme before React hydrates;
      // suppressHydrationWarning keeps that intentional server/client
      // attribute difference from logging a hydration mismatch.
      suppressHydrationWarning
      className={`${archivo.variable} ${bricolageGrotesque.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Must be the first thing in <body> so it runs before paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* GA-4 (Consent Mode v2). No-op unless NEXT_PUBLIC_GA_MEASUREMENT_ID is
            set in the environment, so it ships nothing until the property exists;
            analytics defaults denied in EEA/UK (server-decided), granted else. */}
        <GoogleAnalytics
          measurementId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? ""}
          consentRequired={serverRequiresConsent}
        />
        {/* reCAPTCHA v3 script loader. "use client" leaf that renders null (ships
            no script) unless NEXT_PUBLIC_RECAPTCHA_SITE_KEY is set — so forms
            behave exactly as today until the key exists. The required Google
            disclosure rides in the footer via <RecaptchaNotice /> below. */}
        <RecaptchaProvider />
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* ADR-0012 §4: the server-decided region flag is the authoritative
              signal for the consent gate below; wraps the whole tree so every
              AdSlot/ConsentBanner reads the same decision. */}
          <ConsentRegionProvider serverRequired={serverRequiresConsent}>
            <a className="skip-link" href="#main-content">
              Skip to content
            </a>
            <SerwistProvider swUrl="/serwist/sw.js">
              <AppHeader />
              <main id="main-content" className="app-main">
                {children}
              </main>
              <AppFooter />
              {/* ADR-0012 §4: EEA/UK consent gate. Renders nothing unless
                  AdSense is configured AND the reader's region requires
                  consent AND no choice was made — invisible by default. */}
              <ConsentBanner />
            </SerwistProvider>
          </ConsentRegionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
