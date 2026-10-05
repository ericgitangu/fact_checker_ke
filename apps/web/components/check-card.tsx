import type { Check } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import { ConfidenceGauge, ExternalLinkIcon, ShieldCheckIcon, Reveal } from "@fact-checker-ke/brand";
import { LegalCaveat } from "./legal-caveat";
import { MarkdownText } from "./markdown-text";
import { AwaitingEditorNotice, VerdictStamp } from "./verdict";

/**
 * The fact-check card — the one bold object on a check page, mirroring
 * apps/site's `.checkcard` sample. Renders the published verdict stamp, OR
 * (AT-0004-B) the explicit awaiting-editor state for a draft, never both,
 * never a placeholder stamp.
 */
export async function CheckCard({ check }: { check: Check }): Promise<React.JSX.Element> {
  const t = await getTranslations("check");

  // Awaited explicitly, same reasoning as the `LegalCaveat` await below:
  // `VerdictStamp`/`AwaitingEditorNotice` are async Server Components, and
  // embedding an async component as a bare JSX tag only resolves under
  // Next's real RSC renderer -- plain ReactDOM (as used by
  // @testing-library/react's `render()` in this app's component tests)
  // throws "Only Server Components can be async at the moment" and the
  // whole tree suspends empty. Pre-resolving here keeps CheckCard's own
  // JSX unchanged in shape while making it render correctly under both
  // Next's RSC runtime (production) and a plain-ReactDOM test render.
  const verdictOrAwaitingNotice =
    check.isDraft || !check.rating
      ? await AwaitingEditorNotice()
      : await VerdictStamp({ rating: check.rating });

  // Iconed sources (the credibility marker + external-link cue) are the
  // check-page treatment; the compact feed row keeps its bare list.
  const legalCaveat = !check.isDraft ? await LegalCaveat({ riskTier: check.riskTier }) : null;

  return (
    // One orchestrated reveal on load: the whole record "presses" onto the
    // page (house `press` motion), reduced-motion-safe at the useReveal
    // source + reveal.css belt-and-braces. The verdict seal + stamp then
    // carry their own stamp-in press within it — the one focal accent.
    <Reveal motion="press" threshold={0.05} className="checkcard-reveal">
      <article className="checkcard" aria-label="Fact-check">
        {check.isDraft ? (
          <p className="checkcard-tag">{t("draft.pending")}</p>
        ) : (
          <p className="checkcard-tag checkcard-tag-record">
            <ShieldCheckIcon size={13} />
            fact_checker_ke
          </p>
        )}

        <h1 className="checkcard-claim">
          <MarkdownText content={check.summary} inline />
        </h1>

        {/* The focal "record" row: the pressed verdict stamp, and — for a
            published check — the calibrated confidence dial beside it. A
            confidence weight is NOT a verdict (ADR-0031), so the gauge
            carries the brand accent, never a rating hue. */}
        <div className="checkcard-verdict-row">
          {verdictOrAwaitingNotice}
          {!check.isDraft && check.calibratedConfidence !== null && (
            <ConfidenceGauge
              value={check.calibratedConfidence}
              label={t("guidance.confidenceLabel")}
              size="md"
              className="checkcard-gauge-block"
            />
          )}
        </div>

        {/* ADR-0031/0033: claim-attributed framing, spelled out (not just
            implied by the absence of a person's name) — rendered on every
            published check regardless of tier. */}
        {!check.isDraft && (
          <p className="checkcard-claim-note">{t("guidance.claimAttributedNote")}</p>
        )}

        <section aria-labelledby="claims-h">
          <h2 id="claims-h" className="sr-only">
            {t("claims.heading")}
          </h2>
          <ul className="source-list source-list-claims">
            {check.claims.map((claim) => (
              <li key={claim.id}>
                {claim.text}
                <span className="source-tier"> · {claim.claimType}</span>
              </li>
            ))}
          </ul>
        </section>

        <dl className="checkcard-meta">
          <div>
            <dt>{t("sources.heading")}</dt>
            <dd>
              <ul className="source-list source-list-iconed">
                {check.sources.map((source) => (
                  <li key={source.id}>
                    <span className="source-cred-icon" aria-hidden="true">
                      <ShieldCheckIcon size={15} />
                    </span>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="source-link"
                    >
                      {source.title}
                      <ExternalLinkIcon size={12} className="source-link-ext" />
                    </a>
                    <span className="source-tier">{source.credibilityTier}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>

        {!check.isDraft && check.reviewedBy && (
          <p className="checkcard-rationale checkcard-audited">
            <ShieldCheckIcon size={14} />
            {t("reviewedBy")}
          </p>
        )}

        {!check.isDraft && check.evidence.length > 0 && (
          <section aria-labelledby="evidence-h" className="checkcard-evidence">
            <h2 id="evidence-h" className="checkcard-section-label">
              {t("guidance.evidenceHeading")}
            </h2>
            <ul className="source-list">
              {check.evidence.map((item) => {
                const source = check.sources.find((s) => s.id === item.sourceId);
                return (
                  <li key={`${item.sourceId}-${item.quote}`} className="evidence-quote">
                    &ldquo;{item.quote}&rdquo;
                    {source ? <span className="source-tier"> — {source.title}</span> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {!check.isDraft && check.whatWouldChangeThis && (
          <div className="checkcard-rationale checkcard-change">
            <strong>{t("guidance.whatWouldChangeThisHeading")}:</strong>
            <MarkdownText content={check.whatWouldChangeThis} className="checkcard-change-body" />
          </div>
        )}

        {/* ADR-0033 AT-0033-1: the standing legal caveat renders on every
            PUBLISHED check, every risk tier — never on a draft. Awaited
            explicitly (see `legalCaveat` above) so it also renders under a
            plain ReactDOM test render, not only Next's real RSC renderer. */}
        {legalCaveat}
      </article>
    </Reveal>
  );
}
