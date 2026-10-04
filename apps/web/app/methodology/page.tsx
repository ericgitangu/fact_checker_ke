import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  TwoEngineFlow,
  VerdictScale,
  type TwoEngineFlowCopy,
  type VerdictScaleCopy,
} from "@fact-checker-ke/brand";

export const metadata: Metadata = {
  title: "Methodology — fact_checker_ke",
  description:
    "How fact_checker_ke finds claims, weighs evidence, and publishes confidence-weighted assessments — the rating scale, editorial principles, corrections policy, and how we handle third-party video.",
};

// The six-verdict scale itself is now the shared <VerdictScale> set piece
// (packages/brand) — the bespoke stamped-seal centrepiece that replaced the
// old flat bordered `<dl>` rows here and the coloured-dot list on apps/site,
// so both surfaces render the identical scale, icons, colours and motion.
// Its verdict copy is canonical brand English carried in the component
// (same contract as <TwoEngineFlow>), which is why this page no longer
// keeps its own RATING_DEFINITIONS/RATING_ORDER.

// NOTE (i18n gap, honestly flagged per ADR-0028 scope note): this page's
// long-form PROSE stays English-only in this wave — it is editorial
// content, not UI chrome, and translating it accurately needs editorial
// review rather than a mechanical catalog entry. The `check`/`tracker`/
// `common` namespaces (the ADR's required scope) are fully covered
// elsewhere (submit, status, checks/[id], maandamano, editor).
//
// The two shared brand set pieces on this page (<VerdictScale> and
// <TwoEngineFlow>) ARE now localised: their user-facing copy is passed in
// from the new `brand` i18n namespace below, so the scale and the flow
// render in Swahili when the web locale is SW. apps/site keeps the English
// defaults carried in the components (it passes no copy), so that surface
// is unchanged — see packages/brand/src/{verdict-scale,two-engine-flow}.tsx.
//
// ALIGNMENT PASS (2026-10-04): this page previously described a single
// submission-only intake and a blocking "a human editor reviews every
// draft before it is published" gate. Both are superseded by the
// two-engine pivot (ADR-0032) and the ADR-0031 amendment (auto-publish is
// now the default; the editor is an async auditor, not a pre-publish
// approver, for the large majority of published checks). This rewrite
// tells that corrected story — it does not invent new capabilities.
export default async function MethodologyPage(): Promise<React.JSX.Element> {
  const tb = await getTranslations("brand");

  // Localised copy for the two shared brand set pieces. Keys that resolve to
  // SW under a SW request render the scale/flow in Swahili; apps/site passes
  // nothing and keeps the English defaults carried in the components.
  const scaleCopy: VerdictScaleCopy = {
    true: { name: tb("scale.true.name"), description: tb("scale.true.description") },
    mostly: { name: tb("scale.mostly.name"), description: tb("scale.mostly.description") },
    misleading: {
      name: tb("scale.misleading.name"),
      description: tb("scale.misleading.description"),
    },
    false: { name: tb("scale.false.name"), description: tb("scale.false.description") },
    unproven: { name: tb("scale.unproven.name"), description: tb("scale.unproven.description") },
    notcheckable: {
      name: tb("scale.notcheckable.name"),
      description: tb("scale.notcheckable.description"),
    },
  };
  const flowCopy: TwoEngineFlowCopy = {
    entriesLabel: tb("flow.entriesLabel"),
    stepsLabel: tb("flow.stepsLabel"),
    entries: {
      fetch: { tag: tb("flow.fetch.tag"), title: tb("flow.fetch.title"), body: tb("flow.fetch.body") },
      submit: {
        tag: tb("flow.submit.tag"),
        title: tb("flow.submit.title"),
        body: tb("flow.submit.body"),
      },
    },
    steps: {
      extract: { title: tb("flow.steps.extract.title"), body: tb("flow.steps.extract.body") },
      ground: { title: tb("flow.steps.ground.title"), body: tb("flow.steps.ground.body") },
      assess: { title: tb("flow.steps.assess.title"), body: tb("flow.steps.assess.body") },
      publish: { title: tb("flow.steps.publish.title"), body: tb("flow.steps.publish.body") },
      audit: { title: tb("flow.steps.audit.title"), body: tb("flow.steps.audit.body") },
    },
  };

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

      <section className="flex flex-col gap-4">
        <div>
          <h2 style={{ fontSize: "1.3rem" }}>From a link to a verdict</h2>
          <p className="mt-2" style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
            Most claims we check, we go looking for — the rest, you bring to us.
            No submitted claim gets special treatment, and no claim we find ourselves
            skips review: either way, the same pipeline below checks it.
          </p>
        </div>
        <TwoEngineFlow ariaLabel={tb("flow.ariaLabel")} copy={flowCopy} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 style={{ fontSize: "1.3rem" }}>The rating scale</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>
          Every published check is assigned exactly one of the following ratings, plus a
          calibrated confidence weight (below). Each rating applies to the{" "}
          <strong>claim</strong>, not to the person who made it.
        </p>
        <VerdictScale ariaLabel={tb("scale.ariaLabel")} verdicts={scaleCopy} />
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
