import type { Metadata } from "next";
import { Archivo, Newsreader } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { SerwistProvider } from "@serwist/turbopack/react";
import { AppFooter, AppHeader } from "../components/site-chrome";
import "./globals.css";

// Archivo (regular + the "expanded" display cut) and Newsreader (serif,
// reserved for the human claim under examination) — same visual pairing
// as apps/site, self-hosted via next/font/google (display:swap, CSS
// variable binding, no external <link>, zero layout-shift webfont).
//
// RE-VERIFIED TWICE for "Archivo Expanded" (2026-10-03), two rounds:
//
// Round 1 (wrong conclusion, corrected below): tried `Archivo_Expanded`
// from next/font/google. `tsc` immediately rejected it — "no exported
// member 'Archivo_Expanded'" — which is real signal (TypeScript's types
// come from next's bundled `font-data.json`, not a dynamic probe), not a
// red herring to override.
//
// Round 2 (the actual root cause, confirmed empirically against the live
// Google Fonts API, not assumed): `curl
// "https://fonts.googleapis.com/css2?family=Archivo+Expanded:wght@700;800"`
// returns **400 "Missing font family"** when requested alone. The
// combined request in apps/site's own <link> (multiple families in one
// URL) returns 200, but inspecting the response body shows it silently
// DROPPED "Archivo Expanded" and served only 'Archivo' + 'Newsreader' —
// Google's API tolerates one bad family name in a multi-family request
// by omitting it, which is why apps/site's build never surfaced an
// error. **"Archivo Expanded" is a retired static family**: Google
// merged it into plain "Archivo" as a variable-font width axis (`wdth`,
// confirmed via `fonts.google.com/metadata/fonts/Archivo`: axes
// `{wdth: 62-125}` + `{wght: 100-900}`). apps/site's own headlines are
// therefore ALSO silently falling back to non-expanded "Archivo" in
// every current browser — worth fixing there too, but out of this
// agent's file ownership (apps/site/**).
//
// THE REAL FIX: next/font/google supports selecting extra variable axes
// via `axes: ["wdth"]` (only valid alongside `weight: "variable"` — see
// next/dist/compiled/@next/font/dist/google/validate-google-font-
// function-call.js). One variable Archivo font file covers both the
// --sans (normal width) and --sans-x (expanded width, via the CSS
// `font-stretch` property — "wdth" is a registered axis that maps
// directly to `font-stretch`, see globals.css's `.wordmark-mark` and
// `--stretch-expanded` usage) — cheaper than two separate font loads.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: "variable",
  axes: ["wdth"],
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

export const metadata: Metadata = {
  title: "fact_checker_ke",
  description:
    "Kenyan fact-checking: submit a link or text, get an AI-assisted draft analysis, human-approved before publish.",
  manifest: "/manifest.webmanifest",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${archivo.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>
          <SerwistProvider swUrl="/serwist/sw.js">
            <AppHeader />
            <main id="main-content" className="app-main">
              {children}
            </main>
            <AppFooter />
          </SerwistProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
