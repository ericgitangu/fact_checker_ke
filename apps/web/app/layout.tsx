import type { Metadata } from "next";
import { Archivo, Bricolage_Grotesque, Newsreader } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { SerwistProvider } from "@serwist/turbopack/react";
import { AppFooter, AppHeader } from "../components/site-chrome";
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
      className={`${archivo.variable} ${bricolageGrotesque.variable} ${newsreader.variable} h-full antialiased`}
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
