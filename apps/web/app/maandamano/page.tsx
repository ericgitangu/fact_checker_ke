import { getTranslations } from "next-intl/server";
import { ApiClient, type MaandamanoResponse } from "@fact-checker-ke/core";
import { DemonstrationStatusChip } from "../../components/status-chip";
import { NightBand } from "../../components/night-band";

/**
 * ADR-0007/ADR-0028 AT-0007-A kill switch. `/maandamano` is ISR-cached
 * (tag `"maandamano"`) rather than force-dynamic: advisories change
 * rarely enough that re-rendering on every request would be wasteful
 * CDN-bypass traffic during exactly the high-traffic moments (an active
 * protest) this page exists for. The 60s window bounds ordinary
 * staleness; the kill switch bypasses it entirely by purging the tag
 * (see app/api/revalidate/route.ts, called from
 * services/api/src/lib/maandamano-revalidate.ts right after an admin
 * flips `maandamano_kill_switch` via `POST
 * /v1/admin/maandamano/kill-switch`) so a freeze/unfreeze reaches the
 * CDN fast, without a redeploy.
 *
 * The frozen state itself is NOT a client-side decision: `frozen` comes
 * straight from `GET /v1/maandamano`'s response body
 * (services/api/src/lib/maandamano.ts#getMaandamanoAdvisories), which
 * returns `demonstrations: []` server-side whenever the switch is ON.
 * This component never receives live advisory data to hide while
 * frozen — there is nothing in this render's payload to hide.
 */
export const revalidate = 60;

async function getMaandamanoData(): Promise<MaandamanoResponse> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const client = new ApiClient({ baseUrl: apiBaseUrl });
  return client.getMaandamano({ next: { revalidate: 60, tags: ["maandamano"] } });
}

/**
 * ADR-0007 red-team amendment: an advisory not re-verified within 2h is
 * marked stale rather than silently shown as current. The fixture has no
 * live re-verification clock, so this is evaluated against `updatedAt`.
 */
function isStale(updatedAt: string): boolean {
  const age = Date.now() - Date.parse(updatedAt);
  return Number.isFinite(age) && age > 2 * 60 * 60 * 1000;
}

export default async function MaandamanoPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("tracker");
  const { frozen, demonstrations } = await getMaandamanoData();

  return (
    <div className="shell flex flex-col gap-10">
      <NightBand heading={t("streetHeading")}>
        <p>{t("streetBody")}</p>
        <p className="street-note">{t("streetNote")}</p>
        {frozen && (
          <p className="frozen-banner" role="alert">
            {t("frozen.title")} — {t("frozen.body")}
          </p>
        )}
      </NightBand>

      <div>
        <h1>{t("heading")}</h1>
        <p style={{ color: "var(--ink-2)", marginTop: 6 }}>{t("intro")}</p>
      </div>

      {frozen ? (
        <p className="form-note form-note-muted" role="status">
          {t("frozen.body")}
        </p>
      ) : (
        <ul className="flex flex-col gap-4" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {demonstrations.map((demo) => (
            <li key={demo.id} className="advisory-card">
              <div className="flex items-center justify-between">
                <h3>{demo.title}</h3>
                <DemonstrationStatusChip status={demo.status} />
              </div>
              <p style={{ color: "var(--ink-2)" }}>{demo.summary}</p>
              <div className="advisory-meta">
                <span>
                  {demo.area}, {demo.county}
                  {demo.date ? ` · ${demo.date}` : ""}
                </span>
                {demo.sourceUrl && (
                  <a href={demo.sourceUrl} target="_blank" rel="noopener noreferrer">
                    {t("sourcedFrom")}
                  </a>
                )}
                <span>
                  {t("updatedAt")}: {new Date(demo.updatedAt).toLocaleString()}
                </span>
              </div>
              {isStale(demo.updatedAt) && <p className="advisory-stale">{t("staleWarning")}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
