import type { Metadata } from "next";
import { Archivo, Newsreader } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { SerwistProvider } from "@serwist/turbopack/react";
import { AppFooter, AppHeader } from "../components/site-chrome";
import "./globals.css";

// Archivo (grotesque, the adjudicator's voice) and Newsreader (serif,
// reserved for the human claim under examination) — same pairing as
// apps/site. Google Fonts does not publish "Archivo Expanded" as its own
// family for next/font/google's catalog (only the variable "Archivo"
// family, which carries a width axis Google's static API doesn't expose
// per-instance here); globals.css's `--sans-x` therefore falls back to
// `--sans` at the same weight rather than silently rendering nothing. If a
// future next/font/google catalog update adds "Archivo Expanded" as its
// own importable export, swap this in directly.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500"],
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
