import { getTranslations } from "next-intl/server";
import { demonstrations } from "../../fixtures/demonstrations";
import { DemonstrationStatusChip } from "../../components/status-chip";
import { NightBand } from "../../components/night-band";

export const dynamic = "force-dynamic";

/**
 * ADR-0007/ADR-0028 AT-0007-A kill switch, mocked as an env var for this
 * skeleton (no live operator flag/DB in Phase 0-1 client scope). Flip
 * `MAANDAMANO_FROZEN=true` to see the frozen-notice view instead of
 * advisories. A real kill switch (per the ADR) is a runtime DB/edge-config
 * flag the API exposes, purges CDN tags, and flips the SW to
 * network-first — this env var only covers the apps/web-side rendering
 * half of that contract; the SW network-first policy itself is wired in
 * app/sw.ts regardless of this flag's value, since that must hold even
 * when NOT frozen (a stale cached advisory is unsafe at any time).
 */
function isFrozen(): boolean {
  return process.env.MAANDAMANO_FROZEN === "true";
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
  const frozen = isFrozen();

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
