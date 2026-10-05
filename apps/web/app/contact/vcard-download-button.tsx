"use client";

import { useState } from "react";
import { buildFounderVCard } from "../../lib/contact";

/**
 * Client-only download trigger for the founder's vCard. Builds the `.vcf`
 * payload in-browser from `buildFounderVCard()` (no network round trip,
 * no API route — this is static contact data, not something that needs a
 * backend) and hands the browser a same-page `Blob` URL, matching the
 * pattern Next's App Router docs recommend for client-generated
 * downloads. Revokes the object URL right after the click so it doesn't
 * leak across re-renders.
 */
export function VCardDownloadButton({
  label,
  downloadedLabel,
}: {
  label: string;
  downloadedLabel: string;
}): React.JSX.Element {
  const [downloaded, setDownloaded] = useState(false);

  function handleClick(): void {
    const blob = new Blob([buildFounderVCard()], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "eric-gitangu-fact-checker-ke.vcf";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }

  return (
    <button type="button" className="btn btn-primary" onClick={handleClick}>
      {downloaded ? downloadedLabel : label}
    </button>
  );
}
