"use client";

import { useTranslations } from "next-intl";
import type { UrlDetection } from "../../lib/claim-source-detection";

/**
 * Live preview of what the pasted URL resolved to. Only YouTube gets a
 * real embed (a plain iframe, no SDK — keeps this screen's bundle lean
 * per the mobile-first requirement). Other video platforms (TikTok, X,
 * Threads) show a clearly-labelled "no live preview yet" card instead of
 * pulling in their heavier embed scripts; the link itself is still
 * submitted and checked regardless.
 */
export function SourcePreview({ detection }: { detection: UrlDetection }): React.JSX.Element {
  const t = useTranslations("submit");

  return (
    <div className="source-preview-card reveal-in">
      <span className="detected-pill">
        <span className="dot" aria-hidden="true" />
        {t(`detected.${detection.platform}`)}
      </span>
      {detection.platform === "youtube" && detection.youtubeVideoId ? (
        <div className="source-preview-embed">
          <iframe
            id="source-preview-youtube-frame"
            src={`https://www.youtube.com/embed/${detection.youtubeVideoId}?enablejsapi=1`}
            title="Video preview"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : detection.isVideoPlatform ? (
        <p className="source-preview-noembed">{t("moment.noEmbed")}</p>
      ) : (
        <p className="source-preview-noembed" style={{ wordBreak: "break-all" }}>
          {detection.url}
        </p>
      )}
    </div>
  );
}
