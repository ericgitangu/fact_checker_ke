import type { Check } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import { LegalCaveat } from "./legal-caveat";
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

  return (
    <article className="checkcard" aria-label="Fact-check">
      {check.isDraft ? (
        <p className="checkcard-tag">{t("draft.pending")}</p>
      ) : (
        <p className="checkcard-tag">fact_checker_ke</p>
      )}

      <h1 className="checkcard-claim">{check.summary}</h1>

      {verdictOrAwaitingNotice}

      <section aria-labelledby="claims-h">
        <h2 id="claims-h" className="sr-only">
          {t("claims.heading")}
        </h2>
        <ul className="source-list">
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
            <ul className="source-list">
              {check.sources.map((source) => (
                <li key={source.id}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title}
                  </a>
                  <span className="source-tier">{source.credibilityTier}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      {!check.isDraft && check.reviewedBy && (
        <p className="checkcard-rationale" style={{ marginTop: 16 }}>
          {t("reviewedBy")}
        </p>
      )}

      {/* ADR-0031: a published Check is an assessment, not an accusation —
          the calibrated confidence weight, cited evidence, and the
          falsifiability note are all surfaced here so the reader (not a
          bare verdict) does the judging. `CheckSchema`'s `superRefine`
          (packages/core/src/schemas/check.ts) is what guarantees these
          are non-null on any check that reaches this component with
          `isDraft: false`. */}
      {!check.isDraft && check.calibratedConfidence !== null && (
        <p className="checkcard-confidence">
          {t("guidance.confidenceLabel")}: {Math.round(check.calibratedConfidence * 100)}%
        </p>
      )}

      {/* ADR-0031/0033: claim-attributed framing, spelled out as a label
          next to the confidence weight (not just implied by the absence
          of a person's name) — "we assess the claim, not the person...
          you decide" is the reader-facing restatement of the ADR-0023
          framing rule, rendered on every published check regardless of
          tier. */}
      {!check.isDraft && (
        <p className="checkcard-rationale">{t("guidance.claimAttributedNote")}</p>
      )}

      {!check.isDraft && check.evidence.length > 0 && (
        <section aria-labelledby="evidence-h">
          <h2 id="evidence-h" className="sr-only">
            {t("guidance.evidenceHeading")}
          </h2>
          <ul className="source-list">
            {check.evidence.map((item) => {
              const source = check.sources.find((s) => s.id === item.sourceId);
              return (
                <li key={`${item.sourceId}-${item.quote}`}>
                  &ldquo;{item.quote}&rdquo;
                  {source ? <span className="source-tier"> — {source.title}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!check.isDraft && check.whatWouldChangeThis && (
        <p className="checkcard-rationale">
          <strong>{t("guidance.whatWouldChangeThisHeading")}:</strong> {check.whatWouldChangeThis}
        </p>
      )}

      {/* ADR-0033 AT-0033-1: the standing legal caveat renders on every
          PUBLISHED check, every risk tier (fetch- or submission-sourced) —
          never on a draft, which already carries its own
          AwaitingEditorNotice and has nothing published to caveat yet.
          Awaited explicitly (unlike VerdictStamp/AwaitingEditorNotice
          above, a pre-existing pattern this change does not touch) so the
          caveat also renders correctly under a plain ReactDOM test render
          (@testing-library/react), not only Next's real RSC renderer —
          confirmed empirically: embedding an async Server Component as a
          bare JSX tag fails under plain ReactDOM with "Only Server
          Components can be async at the moment" / an unresolved `act`
          suspension, verified against this exact codebase via a scratch
          test before this fix. */}
      {!check.isDraft && (await LegalCaveat({ riskTier: check.riskTier }))}
    </article>
  );
}
