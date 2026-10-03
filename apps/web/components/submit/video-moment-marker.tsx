"use client";

import { useTranslations } from "next-intl";
import type { UrlDetection } from "../../lib/claim-source-detection";
import { formatMmSs } from "../../lib/claim-source-detection";

const MAX_SCRUBBER_SECONDS = 20 * 60; // 20 min — we don't know real duration (no API call), generous arbitrary ceiling

/**
 * "Mark the moment + the claim" (ADR-0002: never download/clip
 * third-party video — the submitter quotes the exact words instead). For
 * YouTube we can actually seek the embed via the IFrame postMessage API
 * (`enablejsapi=1`, no SDK download needed, just `postMessage` to the
 * iframe we already own) so dragging the scrubber visibly moves the
 * player — a real interactive touch, not a decorative slider. Other
 * platforms get the same scrubber + claim field without a live seek
 * (SourcePreview already shows the "no live preview" note for those).
 */
export function VideoMomentMarker({
  detection,
  timestampSec,
  onTimestampChange,
  quote,
  onQuoteChange,
}: {
  detection: UrlDetection;
  timestampSec: number;
  onTimestampChange: (sec: number) => void;
  quote: string;
  onQuoteChange: (quote: string) => void;
}): React.JSX.Element {
  const t = useTranslations("submit");

  function seekYoutube(sec: number): void {
    const frame = document.getElementById("source-preview-youtube-frame") as HTMLIFrameElement | null;
    frame?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func: "seekTo", args: [sec, true] }),
      "https://www.youtube.com",
    );
  }

  return (
    <div className="moment-marker reveal-in">
      <div className="moment-claim-column" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3>{t("moment.heading")}</h3>
        <p className="field-help">{t("moment.help")}</p>

        <div className="moment-scrubber">
          <label htmlFor="moment-scrubber-input" className="sr-only">
            {t("moment.heading")}
          </label>
          <input
            id="moment-scrubber-input"
            type="range"
            min={0}
            max={MAX_SCRUBBER_SECONDS}
            step={1}
            value={timestampSec}
            onChange={(e) => onTimestampChange(Number(e.target.value))}
            onPointerUp={(e) => {
              if (detection.platform === "youtube") seekYoutube(Number(e.currentTarget.value));
            }}
          />
          <span className="moment-timestamp">{formatMmSs(timestampSec)}</span>
        </div>

        <div className="moment-claim-field field">
          <label htmlFor="moment-claim-text" className="field-label sr-only">
            {t("moment.claimPlaceholder")}
          </label>
          <textarea
            id="moment-claim-text"
            rows={3}
            placeholder={t("moment.claimPlaceholder")}
            value={quote}
            onChange={(e) => onQuoteChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
