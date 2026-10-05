import { getTranslations } from "next-intl/server";
import { ApiClient, type MaandamanoResponse } from "@fact-checker-ke/core";
import { Reveal, MegaphoneIcon } from "@fact-checker-ke/brand";
import { DemonstrationStatusChip } from "../../components/status-chip";
import { EmptyState } from "../../components/empty-state";
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

/**
 * Load outcome for the advisory source. `unavailable` is a first-class,
 * non-throwing outcome: in production the Vercel runtime has no reachable
 * `services/api` (and `API_BASE_URL` may be unset, defaulting to an
 * unreachable `http://localhost:8080`), so the underlying `fetch` throws
 * `TypeError: fetch failed` (ECONNREFUSED). A non-2xx status
 * (`ApiClientError`) or a contract-drift zod parse error land here too.
 * None of these may propagate out of the Server Component — an uncaught
 * throw here is exactly what rendered `/maandamano` as an HTTP 500. The
 * page degrades to an honest "source unavailable" state instead, and
 * NEVER shows a cached/guessed advisory as current (ADR-0007 safety
 * posture: silence is safer than a stale protest advisory).
 */
type MaandamanoLoad =
  | { kind: "ok"; data: MaandamanoResponse }
  | { kind: "unavailable" };

async function getMaandamanoData(): Promise<MaandamanoLoad> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const client = new ApiClient({ baseUrl: apiBaseUrl });
  try {
    const data = await client.getMaandamano({ next: { revalidate: 60, tags: ["maandamano"] } });
    return { kind: "ok", data };
  } catch {
    // Intentionally swallow the error class (network / non-2xx / parse):
    // the branch rendered to the user is the same honest unavailable
    // state regardless of which failure occurred, and the stack is not
    // user-actionable. The thrown detail is already logged by the runtime.
    return { kind: "unavailable" };
  }
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
  const load = await getMaandamanoData();
  const unavailable = load.kind === "unavailable";
  const frozen = load.kind === "ok" && load.data.frozen;
  const demonstrations = load.kind === "ok" ? load.data.demonstrations : [];

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

      <Reveal motion="rise">
        <div>
          <h1>{t("heading")}</h1>
          <p style={{ color: "var(--ink-2)", marginTop: 6 }}>{t("intro")}</p>
        </div>
      </Reveal>

      {frozen ? (
        <p className="form-note form-note-muted" role="status">
          {t("frozen.body")}
        </p>
      ) : unavailable ? (
        <Reveal motion="rise" threshold={0.05}>
          <EmptyState icon={<MegaphoneIcon size={22} />} title={t("offline.title")} description={t("offline.body")} />
        </Reveal>
      ) : demonstrations.length === 0 ? (
        <Reveal motion="rise" threshold={0.05}>
          <EmptyState icon={<MegaphoneIcon size={22} />} title={t("empty.title")} description={t("empty.body")} />
        </Reveal>
      ) : (
        <Reveal motion="rise" threshold={0.05}>
          <ul className="advisory-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {demonstrations.map((demo, i) => (
              <li
                key={demo.id}
                className="advisory-card"
                style={{ "--fck-advisory-i": i } as React.CSSProperties}
              >
                <div className="advisory-card-head">
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
        </Reveal>
      )}
    </div>
  );
}
