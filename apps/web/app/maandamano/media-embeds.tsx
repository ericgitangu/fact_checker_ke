import { getTranslations } from "next-intl/server";
import type { DemonstrationMedia } from "@fact-checker-ke/core";

/**
 * ADR-0035: render an advisory's attached clips as sandboxed iframe
 * EMBEDS (pointers to the source platform, never bytes we serve). A
 * `flagged` embed carries a caveat badge ("may be recycled footage"); a
 * `checking` embed shows a pending note. `embedUrl` is host-allowlisted
 * server-side (packages/core `isPlatformEmbedHost`), so only a platform
 * embed host ever reaches the `src`.
 *
 * The iframe is sandboxed to the minimum a third-party player needs
 * (scripts + same-origin for the player's own origin + presentation for
 * fullscreen), and `referrerPolicy="no-referrer"` avoids leaking the
 * reader's page to the platform (ADR-0007 privacy posture).
 */
export async function MediaEmbeds({ media }: { media: DemonstrationMedia[] }): Promise<React.JSX.Element | null> {
  if (!media || media.length === 0) return null;
  const t = await getTranslations("tracker");

  return (
    <div className="advisory-media">
      <h4 className="advisory-media-heading">{t("media.heading")}</h4>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {media.map((clip) => {
          const flagged = clip.misinfoStatus === "flagged";
          const checking = clip.misinfoStatus === "checking" || clip.misinfoStatus === "unchecked";
          return (
            <li key={clip.id} className="advisory-media-item">
              {flagged && (
                <p className="advisory-media-flagged" role="alert">
                  {t("media.flaggedBadge")}
                  {clip.misinfoNote ? ` ${clip.misinfoNote}` : ""}
                </p>
              )}
              {checking && <p className="advisory-media-checking">{t("media.checking")}</p>}
              <div className="advisory-media-frame">
                <iframe
                  src={clip.embedUrl}
                  title={t("media.clipTitle", { platform: clip.platform })}
                  loading="lazy"
                  sandbox="allow-scripts allow-same-origin allow-presentation"
                  referrerPolicy="no-referrer"
                  allow="encrypted-media; picture-in-picture"
                  style={{ width: "100%", aspectRatio: "16 / 9", border: 0, borderRadius: 8 }}
                />
              </div>
              {clip.caption && <p className="advisory-media-caption">{clip.caption}</p>}
              <p className="advisory-media-source">
                <a href={clip.embedUrl} target="_blank" rel="noopener noreferrer">
                  {t("media.viewSource")}
                </a>
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
