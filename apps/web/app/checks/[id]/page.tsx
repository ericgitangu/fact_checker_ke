import { notFound } from "next/navigation";
import {
  ApiClient,
  ApiClientError,
  buildClaimReviewJsonLd,
  ClaimReviewValidationError,
} from "@fact-checker-ke/core";

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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      {claimReviewJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(claimReviewJsonLd) }}
        />
      )}

      {check.isDraft && (
        <div className="rounded border border-amber-400 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          AI-assisted analysis — not a verdict. Pending human review.
        </div>
      )}

      <h1 className="text-2xl font-semibold">{check.summary}</h1>

      {check.rating && (
        <p className="text-lg">
          Rating: <span className="font-medium">{check.rating}</span>
        </p>
      )}

      <section>
        <h2 className="mb-2 text-lg font-medium">Claims</h2>
        <ul className="flex flex-col gap-2">
          {check.claims.map((claim) => (
            <li key={claim.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <p>{claim.text}</p>
              <p className="text-xs text-zinc-500">{claim.claimType}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Sources</h2>
        <ul className="flex flex-col gap-2">
          {check.sources.map((source) => (
            <li key={source.id}>
              <a href={source.url} className="underline">
                {source.title}
              </a>{" "}
              <span className="text-xs text-zinc-500">({source.credibilityTier})</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
