import { notFound } from "next/navigation";
import { ZodError } from "zod";
import {
  ApiClient,
  ApiClientError,
  buildClaimReviewJsonLd,
  ClaimReviewValidationError,
} from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import { CheckCard } from "../../../components/check-card";
import { AiAssistedNote } from "../../../components/verdict";
import { AdSlot } from "../../../components/ads/ad-slot";
import { PremiumUpsell } from "../../../components/premium/premium-upsell";

export const dynamic = "force-dynamic";

async function getCheck(id: string) {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const client = new ApiClient({ baseUrl: apiBaseUrl });
  try {
    return await client.getCheck(id);
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) {
      return null;
    }
    // Defense-in-depth (ADR-0031 AT-0031-1): if the API ever returns a check
    // that violates the published-check contract — e.g. a LEGACY published
    // check persisted before the orchestrator carried evidence, which has no
    // evidence[] — CheckSchema.parse throws. Treat it as "not viewable" (404)
    // rather than 500-ing the page. The real fix is upstream (the pipeline
    // now emits citations and the orchestrator persists them + refuses to
    // auto-publish an un-cited check); this just stops a stale row crashing.
    if (err instanceof ZodError) {
      console.error(`check ${id} failed CheckSchema validation; treating as not found`, err.issues);
      return null;
    }
    throw err;
  }
}

export default async function CheckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const check = await getCheck(id);

  if (!check) {
    notFound();
  }

  const t = await getTranslations("check");

  let claimReviewJsonLd: object | null = null;
  if (!check.isDraft) {
    try {
      claimReviewJsonLd = buildClaimReviewJsonLd(check, {
        url: `https://fact-checker.ke/checks/${check.id}`,
        publisherName: "fact_checker_ke",
        publisherUrl: "https://fact-checker.ke",
      });
    } catch (err) {
      // A published check should always have a rating + claims; if it
      // doesn't, that is a data integrity bug worth surfacing rather than
      // silently omitting the structured data.
      if (!(err instanceof ClaimReviewValidationError)) throw err;
    }
  }

  return (
    <div className="shell-narrow flex flex-col gap-6">
      {claimReviewJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(claimReviewJsonLd) }}
        />
      )}

      {check.isDraft && (
        <div>
          <AiAssistedNote />
          <p style={{ marginTop: 8, fontSize: "0.85rem", color: "var(--ink-3)" }}>{t("draft.pending")}</p>
        </div>
      )}

      <CheckCard check={check} />

      {/* ADR-0012 §4: in-article ad unit — BELOW the full assessment, never
          above the fold and never between a claim and its evidence (those
          all live inside <CheckCard> above). Renders nothing until the
          owner configures AdSense, and nothing for Premium readers. The
          Premium upsell sits beside it as the contextual "go ad-free"
          moment — and, for a Premium reader (no ad), still stands on its
          own as a quiet support nudge. */}
      <AdSlot slot="inArticle" className="ad-slot-in-article" />
      {await PremiumUpsell({ variant: "inline" })}
    </div>
  );
}
