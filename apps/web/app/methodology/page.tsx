import type { Metadata } from "next";
import type { Rating } from "@fact-checker-ke/core";

export const metadata: Metadata = {
  title: "Methodology — fact_checker_ke",
  description:
    "How fact_checker_ke rates claims: the rating scale, editorial principles, corrections policy, and how we handle third-party video.",
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
export default function MethodologyPage(): React.JSX.Element {
  return (
    <div className="shell-narrow flex flex-col gap-10">
      <div>
        <h1>Methodology</h1>
        <p className="mt-3" style={{ color: "var(--ink-2)" }}>
          fact_checker_ke is an independent, open-source fact-checking project for Kenya.
          This page describes how we rate claims and the editorial principles we follow.
          We are not an IFCN signatory — this describes our own process, not an external
          certification.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 style={{ fontSize: "1.3rem" }}>The rating scale</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          Every published check is assigned exactly one of the following ratings. Each
          rating applies to the <strong>claim</strong>, not to the person who made it.
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
        <h2 style={{ fontSize: "1.3rem" }}>We rate claims, not people</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          We do not publish &ldquo;liar&rdquo; scores, creator leaderboards, or any ranking of who
          makes false claims most often. Our output is a rating and rationale attached to
          a specific, quoted claim.
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
        <h2 style={{ fontSize: "1.3rem" }}>AI-assisted, human-approved</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          Submitted claims are drafted with AI assistance — retrieval against known
          sources, plus a proposed rating and rationale. These drafts are clearly labelled
          &ldquo;AI-assisted analysis&rdquo; and are never published as-is. A human editor reviews,
          and where needed corrects, every draft before it is published.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 style={{ fontSize: "1.3rem" }}>Right of reply and corrections</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          Named individuals are given an opportunity to respond before a &ldquo;False&rdquo; verdict
          about them is published, except where an urgent public-safety claim makes that
          impractical. If we get something wrong, we correct the published check and note
          the correction — we do not silently edit a verdict after the fact.
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
    </div>
  );
}
