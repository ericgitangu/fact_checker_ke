"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ADSENSE_CLIENT, resolveSlotId, shouldRenderAd, type AdSlotName } from "../../lib/ads";
import { useAdsConsent } from "../../lib/consent";
import { useEntitlement } from "../../lib/use-entitlement";

/**
 * ADR-0012 §4 — a reusable, CLS-safe AdSense unit.
 *
 * INVISIBLE BY DEFAULT: renders NOTHING unless `NEXT_PUBLIC_ADSENSE_CLIENT`
 * AND this placement's slot id are set (see lib/ads.ts). Premium readers
 * (ad-free entitlement, ADR-0012 §3) and EEA/UK readers who haven't
 * consented (ADR-0012 §4 CMP) also render nothing.
 *
 * CLS-SAFE: the outer wrapper reserves `minHeight` from first paint, so the
 * surrounding layout never shifts when the ad fills in. LAZY: the ad unit
 * only initialises once it scrolls near the viewport (IntersectionObserver),
 * so an off-screen slot costs nothing.
 *
 * Standard markup: a single shared loader script (added once per document)
 * plus one `<ins class="adsbygoogle">` per slot, pushed to `adsbygoogle`.
 * Clearly LABELLED "Ad" (ADR-0012 §4 / AdSense policy).
 */

const LOADER_ID = "adsbygoogle-loader";

function ensureLoaderScript(client: string): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(LOADER_ID)) return;
  const script = document.createElement("script");
  script.id = LOADER_ID;
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(script);
}

export function AdSlot({
  slot,
  minHeight = 280,
  className,
}: {
  slot: AdSlotName;
  /** Reserved height (px) to prevent layout shift. Default 280 (a responsive block). */
  minHeight?: number;
  className?: string;
}): React.JSX.Element | null {
  const t = useTranslations("ads");
  const slotId = resolveSlotId(slot);
  const { adFree } = useEntitlement();
  const { satisfied } = useAdsConsent();
  const containerRef = useRef<HTMLModElement>(null);
  const [inView, setInView] = useState(false);
  const pushedRef = useRef(false);

  const render = shouldRenderAd({ client: ADSENSE_CLIENT, slotId, adFree, consentSatisfied: satisfied });

  // Lazy-init: observe the slot and only flip `inView` when it nears the
  // viewport. Gated on `render` so we never observe a slot that won't show.
  useEffect(() => {
    if (!render || inView) return;
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      // No observer (very old browser / SSR hand-off edge) — show eagerly.
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [render, inView]);

  // Push to adsbygoogle exactly once, after the loader is present and the
  // slot is in view.
  useEffect(() => {
    if (!render || !inView || pushedRef.current || !ADSENSE_CLIENT) return;
    ensureLoaderScript(ADSENSE_CLIENT);
    try {
      const w = window as unknown as { adsbygoogle?: unknown[] };
      w.adsbygoogle = w.adsbygoogle ?? [];
      w.adsbygoogle.push({});
      pushedRef.current = true;
    } catch {
      // adsbygoogle not ready / blocked — the <ins> stays reserved but
      // empty; no layout shift, no thrown error.
    }
  }, [render, inView]);

  if (!render) return null;

  return (
    <aside
      className={`ad-slot${className ? ` ${className}` : ""}`}
      aria-label={t("label")}
      style={{ minHeight }}
    >
      <span className="ad-slot-label" aria-hidden="true">
        {t("label")}
      </span>
      <ins
        ref={containerRef}
        className="adsbygoogle"
        style={{ display: "block", minHeight }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
