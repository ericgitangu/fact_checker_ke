import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ApiClient, type MaandamanoArchiveResponse } from "@fact-checker-ke/core";
import { Reveal, MegaphoneIcon } from "@fact-checker-ke/brand";
import { DemonstrationStatusChip } from "../../../components/status-chip";
import { EmptyState } from "../../../components/empty-state";
import { MediaEmbeds } from "../media-embeds";

/**
 * ADR-0035 archive read model (AT-0035-5). Kill-switch-gated through the
 * same server-side frozen check as the live list (the API returns
 * `frozen: true` + `archived: []`), so a frozen surface shows nothing
 * here either. ISR-cached under the same `"maandamano"` tag so a
 * freeze/unfreeze purge (services/api/src/lib/maandamano-revalidate.ts)
 * reaches this route too; the existing `NetworkOnly` service-worker rule
 * for `/maandamano*` covers `/maandamano/archive` (no offline cache of a
 * frozen surface).
 */
export const revalidate = 60;

type ArchiveLoad = { kind: "ok"; data: MaandamanoArchiveResponse } | { kind: "unavailable" };

async function getArchiveData(): Promise<ArchiveLoad> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const client = new ApiClient({ baseUrl: apiBaseUrl });
  try {
    const data = await client.getMaandamanoArchive({ next: { revalidate: 60, tags: ["maandamano"] } });
    return { kind: "ok", data };
  } catch {
    return { kind: "unavailable" };
  }
}

export default async function MaandamanoArchivePage(): Promise<React.JSX.Element> {
  const t = await getTranslations("tracker");
  const load = await getArchiveData();
  const unavailable = load.kind === "unavailable";
  const frozen = load.kind === "ok" && load.data.frozen;
  const archived = load.kind === "ok" ? load.data.archived : [];

  return (
    <div className="shell flex flex-col gap-10">
      <Reveal motion="rise">
        <div>
          <h1>{t("archive.heading")}</h1>
          <p style={{ color: "var(--ink-2)", marginTop: 6 }}>{t("archive.intro")}</p>
          <p style={{ marginTop: 6 }}>
            <Link href="/maandamano">{t("archive.backToLive")}</Link>
          </p>
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
      ) : archived.length === 0 ? (
        <Reveal motion="rise" threshold={0.05}>
          <EmptyState
            icon={<MegaphoneIcon size={22} />}
            title={t("archive.empty.title")}
            description={t("archive.empty.body")}
          />
        </Reveal>
      ) : (
        <Reveal motion="rise" threshold={0.05}>
          <ul className="advisory-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {archived.map((demo, i) => (
              <li key={demo.id} className="advisory-card" style={{ "--fck-advisory-i": i } as React.CSSProperties}>
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
                </div>

                {demo.statusHistory.length > 0 && (
                  <div className="advisory-history">
                    <h4 className="advisory-history-heading">{t("archive.statusHistory")}</h4>
                    <ol style={{ margin: 0, paddingLeft: 18 }}>
                      {demo.statusHistory.map((ev, j) => (
                        <li key={`${demo.id}-${j}`}>
                          <span>{t(`status.${ev.status}`)}</span>
                          <span style={{ color: "var(--ink-2)" }}> · {new Date(ev.occurredAt).toLocaleString()}</span>
                          {ev.note ? <span style={{ color: "var(--ink-2)" }}> — {ev.note}</span> : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <MediaEmbeds media={demo.media} />
              </li>
            ))}
          </ul>
        </Reveal>
      )}
    </div>
  );
}
