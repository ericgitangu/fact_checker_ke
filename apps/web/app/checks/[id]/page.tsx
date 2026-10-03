import { notFound } from "next/navigation";
import {
  ApiClient,
  ApiClientError,
  buildClaimReviewJsonLd,
  ClaimReviewValidationError,
} from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import { CheckCard } from "../../../components/check-card";
import { AiAssistedNote } from "../../../components/verdict";

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
    </div>
  );
}
