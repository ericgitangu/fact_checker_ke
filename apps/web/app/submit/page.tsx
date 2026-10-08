import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Stagger } from "@fact-checker-ke/brand";
import { SubmitForm } from "../submit-form";

export const metadata: Metadata = {
  title: "Submit a claim — fact_checker_ke",
  description:
    "Paste a link or type what someone said. AI weighs it against the evidence and publishes a confidence-weighted assessment, sources cited — people audit it afterward.",
};

/**
 * The smart-input submit screen. It used to be the home page (`/`); the
 * single-frontend consolidation (ADR-0010/0015 amendments, 2026-10-04)
 * moved the marketing landing onto `/`, so submit now has its own route —
 * reached from the hero's primary CTA, the header nav, and anywhere else
 * that links to it. The form itself (<SubmitForm>) is unchanged.
 */
export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}): Promise<React.JSX.Element> {
  // ?url= prefill (the needs_quote tracker CTA deep-links here). Treated as
  // untrusted text: it only seeds the textarea, which the user can edit.
  const { url } = await searchParams;
  const initialUrl = typeof url === "string" ? url.slice(0, 2048) : "";
  const t = await getTranslations("submit");

  return (
    <div className="shell flex flex-col gap-12" style={{ maxWidth: 720, marginInline: "auto" }}>
      <Stagger className="flex flex-col gap-3" motion="rise" step={0.1} threshold={0.01}>
        <h1 className="font-expanded" style={{ fontSize: "clamp(2rem, 4.5vw, 3rem)" }}>
          {t("heading")}
        </h1>
        <p style={{ maxWidth: "52ch", color: "var(--ink-2)" }}>{t("lede")}</p>
      </Stagger>
      <SubmitForm initialUrl={initialUrl} />
    </div>
  );
}
