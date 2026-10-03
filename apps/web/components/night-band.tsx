/**
 * The one dark "night" band, reserved for maandamano (the live street) —
 * matches apps/site's `.street` section. Never used elsewhere; a second
 * dark section would dilute it as a signal that "this is the live/urgent
 * one".
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
      <div className="street-inner">
        <h2 id="street-h">{heading}</h2>
        {children}
      </div>
    </section>
  );
}
