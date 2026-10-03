import { useEffect, useId, useState } from "react";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    // Guard for environments without matchMedia (jsdom tests, SSR): default
    // to motion-on; reduced-motion is still honoured wherever the API exists.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

type WavingFlagProps = {
  className?: string;
  /** Accessible label; omit visual label since the wordmark text carries meaning. */
  title?: string;
};

/**
 * A small Kenyan flag on a pole that waves in the wind: the real flag
 * (black / white-fimbriated red / green bands + the Maasai shield over two
 * crossed spears), rippled with an SVG turbulence+displacement cloth filter.
 * Motion is gated on prefers-reduced-motion — reduced renders a still,
 * gently-furled flag rather than a flat bar.
 */
export function WavingFlag({ className, title = "Kenya" }: WavingFlagProps): React.JSX.Element {
  const reduced = usePrefersReducedMotion();
  const uid = useId().replace(/:/g, "");
  const wave = `wave-${uid}`;
  const sheen = `sheen-${uid}`;
  const pole = `pole-${uid}`;

  return (
    <svg
      className={className}
      viewBox="0 0 54 34"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={pole} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8a8f93" />
          <stop offset="0.5" stopColor="#d7dadc" />
          <stop offset="1" stopColor="#6c7175" />
        </linearGradient>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="0.35">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.7" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.12" />
        </linearGradient>
        <filter id={wave} x="-15%" y="-25%" width="135%" height="150%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.018 0.052"
            numOctaves="2"
            seed="4"
            result="noise"
          >
            {!reduced && (
              <animate
                attributeName="baseFrequency"
                dur="7s"
                values="0.018 0.05;0.026 0.07;0.016 0.045;0.018 0.05"
                repeatCount="indefinite"
              />
            )}
          </feTurbulence>
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="3.2"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>

      {/* Pole */}
      <circle cx="1.6" cy="2.4" r="1.6" fill="#c8a24a" />
      <rect x="0.8" y="2.4" width="1.6" height="31" rx="0.8" fill={`url(#${pole})`} />

      {/* Cloth (rippled) */}
      <g filter={`url(#${wave})`}>
        {/* Bands: black / white / red / white / green (official order) */}
        <rect x="3" y="2" width="50" height="8.5" fill="#101010" />
        <rect x="3" y="10.5" width="50" height="2" fill="#f6f6f4" />
        <rect x="3" y="12.5" width="50" height="9.5" fill="#be1e2d" />
        <rect x="3" y="22" width="50" height="2" fill="#f6f6f4" />
        <rect x="3" y="24" width="50" height="8.5" fill="#046a38" />

        {/* Two crossed white spears behind the shield */}
        <g stroke="#f6f6f4" strokeWidth="1.1" strokeLinecap="round">
          <line x1="22.5" y1="8.5" x2="33.5" y2="25.5" />
          <line x1="33.5" y1="8.5" x2="22.5" y2="25.5" />
        </g>
        {/* spear tips */}
        <path d="M22.5 8.5 l1.4 0.1 -0.9 1.1 z" fill="#f6f6f4" />
        <path d="M33.5 8.5 l-1.4 0.1 0.9 1.1 z" fill="#f6f6f4" />

        {/* Maasai shield: red field, white centre stripe, black caps */}
        <ellipse cx="28" cy="17" rx="3.9" ry="8.1" fill="#be1e2d" />
        <path d="M28 8.9 a3.9 8.1 0 0 1 3.9 5.2 h-7.8 a3.9 8.1 0 0 1 3.9 -5.2 z" fill="#101010" />
        <path d="M28 25.1 a3.9 8.1 0 0 1 -3.9 -5.2 h7.8 a3.9 8.1 0 0 1 -3.9 5.2 z" fill="#101010" />
        <rect x="27.3" y="9.4" width="1.4" height="15.2" fill="#f6f6f4" />

        {/* Cloth sheen / light */}
        <rect x="3" y="2" width="50" height="30.5" fill={`url(#${sheen})`} />
      </g>
    </svg>
  );
}
