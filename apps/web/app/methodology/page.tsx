import type { Metadata } from "next";
import type { Rating } from "@fact-checker-ke/core";

export const metadata: Metadata = {
  title: "Methodology — fact_checker_ke",
  description:
    "How fact_checker_ke finds claims, weighs evidence, and publishes confidence-weighted assessments — the rating scale, editorial principles, corrections policy, and how we handle third-party video.",
};

const RATING_DEFINITIONS: Record<Rating, string> = {
  True: "The claim is accurate and not missing material context.",
  MostlyTrue: "The claim is largely accurate, but needs clarification or is missing minor context.",
  Misleading: "The claim contains accurate elements but is framed or presented in a way that is likely to create a false impression.",
  False: "The claim is contradicted by the evidence we reviewed.",
  Unproven: "There isn't enough publicly available, credible evidence to confirm or deny the claim.",
  NotCheckable: "The statement is an opinion, prediction, or rhetoric rather than a checkable factual claim.",
};

// Fixed display order for the rating scale — RatingSchema.options preserves
// declaration order already, but spelling it out keeps this page's order
// stable even if the schema's enum order ever changes.
const RATING_ORDER: Rating[] = [
  "True",
  "MostlyTrue",
  "Misleading",
  "False",
  "Unproven",
  "NotCheckable",
];

// NOTE (i18n gap, honestly flagged per ADR-0028 scope note): this page's
// prose stays English-only in this wave — it is long-form editorial
// content, not UI chrome, and translating it accurately needs editorial
// review rather than a mechanical catalog entry. The `check`/`tracker`/
// `common` namespaces (the ADR's required scope) are fully covered
// elsewhere (submit, status, checks/[id], maandamano, editor).
//
// ALIGNMENT PASS (2026-10-04): this page previously described a single
// submission-only intake and a blocking "a human editor reviews every
// draft before it is published" gate. Both are superseded by the
// two-engine pivot (ADR-0032) and the ADR-0031 amendment (auto-publish is
// now the default; the editor is an async auditor, not a pre-publish
// approver, for the large majority of published checks). This rewrite
// tells that corrected story — it does not invent new capabilities.
export default function MethodologyPage(): React.JSX.Element {
  return (
    <div className="shell-narrow flex flex-col gap-10">
      <div>
        <h1>Methodology</h1>
        <p className="mt-3" style={{ color: "var(--ink-2)" }}>
          fact_checker_ke is an independent, open-source fact-checking project for Kenya,
          run as a pilot. This page describes how claims reach us, how we weigh evidence,
          and the editorial principles we follow. We are not an IFCN signatory — this
          describes our own process, not an external certification.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 style={{ fontSize: "1.3rem" }}>Two ways a claim gets checked</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          Most claims we check, we go looking for: we watch for claims that are
          trending or spreading on YouTube and X, cross-checked against
          debunking already published by partners like PesaCheck and Africa Check. TikTok
          is embed-only in this pilot — we don&rsquo;t run autonomous discovery there; a TikTok
          clip enters only when it has already spread to a platform we do monitor.
        </p>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          You can also submit a claim directly — paste a link or type what someone said.
          Either way, the same pipeline checks it: no submitted claim gets special
          treatment, and no claim we find ourselves skips review.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 style={{ fontSize: "1.3rem" }}>The rating scale</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          Every published check is assigned exactly one of the following ratings, plus a
          calibrated confidence weight (below). Each rating applies to the{" "}
          <strong>claim</strong>, not to the person who made it.
        </p>
        <dl className="flex flex-col gap-3">
          {RATING_ORDER.map((rating) => (
            <div key={rating} style={{ border: "1px solid var(--rule)", borderRadius: 10, padding: 14 }}>
              <dt style={{ fontWeight: 600, color: "var(--ink)" }}>{rating}</dt>
              <dd style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
                {RATING_DEFINITIONS[rating]}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 style={{ fontSize: "1.3rem" }}>Confidence-weighted, not a bare verdict</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          A published check is an <strong>assessment</strong>, not an accusation. Alongside
          the rating, we show a calibrated confidence weight, the sources we relied on, and
          &ldquo;what would change this&rdquo; — the evidence that would move our assessment.
          The claim and the evidence are in front of you; you decide how much weight to
          give it.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 style={{ fontSize: "1.3rem" }}>We rate claims, not people</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          We do not publish &ldquo;liar&rdquo; scores, creator leaderboards, or any ranking of who
          makes false claims most often. Our output is a rating and rationale attached to
          a specific, quoted claim. When the hardest case comes up — evidence that doesn&rsquo;t
          support a claim made by a named, living person — we publish it as a
          claim-attributed open question (&ldquo;the evidence we found does not support this
          claim as stated, here is why&rdquo;), never as a declarative statement about that
          person. They have a right of reply and correction.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 style={{ fontSize: "1.3rem" }}>Nonpartisanship and source transparency</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          We check claims regardless of who made them or what side of a debate they fall
          on. Every published check lists the sources we relied on, so readers can verify
          our reasoning independently. We quote, attribute, and link to other
          fact-checkers&rsquo; work rather than republishing it in full.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 style={{ fontSize: "1.3rem" }}>AI-assisted, with human audit</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          Claims are assessed with AI assistance — retrieval against known sources, plus a
          confidence-weighted rating and rationale, labelled &ldquo;AI-assisted analysis&rdquo;
          throughout. Most assessments publish automatically once the evidence is weighed;
          a human does not stand between every draft and publication. Instead, editors{" "}
          <strong>audit a sample of published checks after the fact</strong> — a
          proportion that is deliberately high while this pilot is young, and that shrinks
          over time as our calibration is measured and proven. The highest-risk cases
          (a hard-negative finding about a named, living person) default to the
          claim-attributed open-question framing described above, with the standing
          caveat shown on every published check, and can be configured to require a
          pre-publish human check where the exposure warrants it. A kill-switch halts all
          autonomous publishing within one cycle if we need to stop and reassess.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 style={{ fontSize: "1.3rem" }}>Right of reply and corrections</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          Named individuals have a right of reply and correction on anything published
          about a claim they made. For most checks this is handled asynchronously — after
          publication, not as a precondition of it — except where a stricter, configured
          handling mode applies. If we get something wrong, we correct the published check
          and note the correction — we do not silently edit an assessment after the fact.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 style={{ fontSize: "1.3rem" }}>How we handle third-party video</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          For claims made in a third-party video (for example on YouTube or TikTok), we do
          not download or store the underlying audio or video. When you submit a video
          URL, you can optionally include the exact quote and the timestamp it occurs at —
          we fact-check that quoted text, and show the platform&rsquo;s own embed for context.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 style={{ fontSize: "1.3rem" }}>A pilot that improves as it learns</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          fact_checker_ke is a pilot. Our methods and calibration are still being proven;
          error rates are non-zero and disclosed, not hidden behind a confident tone. Every
          published check, editor correction, and reader agree/dispute signal feeds back
          into improving the system — the human-audit rate and publish thresholds loosen
          only as measured accuracy earns it, not on a fixed schedule. This is
          AI-assisted guidance for research and educational purposes — not professional,
          legal, or electoral advice to act on.
        </p>
      </section>
    </div>
  );
}
