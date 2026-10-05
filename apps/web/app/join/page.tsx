import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ExternalLinkIcon } from "@fact-checker-ke/brand";
import { WaitlistForm } from "../../components/waitlist-form";
import { GITHUB_REPO_URL } from "../../lib/site";

export const metadata: Metadata = {
  title: "How to join the movement — fact_checker_ke",
  description:
    "Contribute code, submit claims, or partner with fact_checker_ke — Kenya's open-source fact-checking project.",
};

/**
 * "How to join the movement" — the footer's Project-column counterpart
 * to `/contact`. Three concrete, honest ways in (contribute on GitHub,
 * submit a claim, partner/sponsor), plus a forward-looking note: the
 * project is fully open-source today, but as monetization matures parts
 * of it may move to a gated/private-access model (ADR-0012's Premium/
 * sponsorship tracks), so early interest is worth registering now. The
 * waitlist capture itself reuses the real `<WaitlistForm>` already wired
 * to `/api/waitlist` (same component the landing page uses) — there is no
 * separate "contributor interest" backend to stand up for this page.
 */
export default async function JoinPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("join");

  return (
    <div className="shell-narrow flex flex-col gap-10">
      <div>
        <h1>{t("title")}</h1>
        <p className="mt-3" style={{ color: "var(--ink-2)" }}>
          {t("intro")}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 style={{ fontSize: "1.2rem" }}>{t("mission.heading")}</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>{t("mission.body")}</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 style={{ fontSize: "1.2rem" }}>{t("ways.heading")}</h2>
        <div className="join-ways">
          <div className="join-way-card">
            <h3>{t("ways.contribute.title")}</h3>
            <p>{t("ways.contribute.body")}</p>
            <a
              className="landing-link"
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t("ways.contribute.cta")}
              <ExternalLinkIcon size={13} aria-hidden="true" />
            </a>
          </div>
          <div className="join-way-card">
            <h3>{t("ways.check.title")}</h3>
            <p>{t("ways.check.body")}</p>
            <Link className="landing-link" href="/submit">
              {t("ways.check.cta")}
            </Link>
          </div>
          <div className="join-way-card">
            <h3>{t("ways.partner.title")}</h3>
            <p>{t("ways.partner.body")}</p>
            <a className="landing-link" href="#register-interest">
              {t("ways.partner.cta")}
            </a>
          </div>
        </div>
      </section>

      <div className="join-future-note">
        <h2>{t("futureNote.heading")}</h2>
        <p>{t("futureNote.body")}</p>
      </div>

      <section id="register-interest" className="landing-waitlist flex flex-col gap-4">
        <div className="landing-section-intro">
          <h2>{t("register.heading")}</h2>
          <p>{t("register.body")}</p>
        </div>
        <WaitlistForm />
      </section>
    </div>
  );
}
