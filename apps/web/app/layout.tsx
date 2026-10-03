import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "fact_checker_ke",
  description: "Kenyan fact-checking: submit a link or text, get an AI-assisted draft analysis, human-approved before publish.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <nav className="mx-auto flex max-w-3xl items-center justify-between">
            <Link href="/" className="font-semibold">
              fact_checker_ke
            </Link>
            <Link href="/maandamano" className="text-sm text-zinc-600 dark:text-zinc-400">
              Maandamano advisories
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
