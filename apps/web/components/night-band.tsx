/**
 * The one dark "night" band, reserved for maandamano (the live street) —
 * matches apps/site's `.street` section. Never used elsewhere; a second
 * dark section would dilute it as a signal that "this is the live/urgent
 * one".
 *
 * Elevated into a crafted element (design pass 2026-10-04): a faint
 * grid-on-mask backdrop (already in globals.css), plus a decorative "live
 * signal" — concentric pulsing rings in the corner, the same live-pulse
 * cue as the Maandamano "ongoing" status chip — so the band reads as an
 * active monitoring surface, not just a dark box. The signal is purely
 * decorative (aria-hidden) and fully reduced-motion-safe (globals.css).
 */
export function NightBand({
  heading,
  children,
}: {
  heading: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="street" aria-labelledby="street-h">
      <span className="street-signal" aria-hidden="true">
        <span className="street-signal-dot" />
      </span>
      <div className="street-inner">
        <h2 id="street-h">{heading}</h2>
        {children}
      </div>
    </section>
  );
}
