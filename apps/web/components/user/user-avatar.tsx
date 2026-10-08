import type React from "react";

/**
 * UserAvatar — a logged-in user's avatar, pure and presentational.
 *
 * Shows the user's profile `image` when one is supplied; otherwise their
 * initials on a deterministic, theme-stable background derived from the
 * name. Takes props only (no session/auth coupling) so it can be dropped
 * into the header, a comment byline, an editor roster, etc. — the caller
 * passes `name`/`image` from wherever it already has the session.
 *
 * DESIGN NOTES (why it looks the way it does, so it stays of-a-piece):
 *
 * - Deterministic ground, NOT a random gradient. The background is one of a
 *   small, fixed palette picked by hashing the name, so the same person
 *   always gets the same identity colour. The palette is a set of deep,
 *   restrained editorial/earth tones (graphite, forest, brand green, slate,
 *   steel, teal, aubergine, clay) that read as "gravitas and restraint"
 *   (globals.css's brief) rather than a flashy SaaS rainbow — of-a-piece
 *   with a Kenyan fact-checking product, not a templated AI avatar.
 *
 * - The palette DELIBERATELY excludes the verdict hues (--false red,
 *   --misleading amber) and the --premium accent. The codebase is careful
 *   never to reuse a verdict colour for non-verdict UI (see
 *   components/status-chip.tsx, globals.css `--status-*`): a red-grounded
 *   avatar could read as a "false" flag on the *person*. The one brand-green
 *   entry is a deeper forest green than the --true verdict swatch for the
 *   same reason.
 *
 * - The grounds are FIXED hex, not `var(--ink)`/`var(--true)` etc. Those
 *   tokens invert between light and dark (verified against globals.css:
 *   --ink flips #15181b→#f1f3ef, --true #0d7c47→#30cf84, --status-slate/
 *   -neutral likewise), so referencing them as a dark ground would flip to a
 *   light ground with light text in dark mode and fail contrast. The hues
 *   here are harmonised with those tokens but held constant — which is also
 *   the right product behaviour: an identity colour shouldn't change with the
 *   theme. The hues are drawn from the site's own register; the foreground is
 *   --paper (#fafaf7). Every pairing clears WCAG AA for the initials
 *   (computed white/paper-on-ground ratios 6.3:1 … 17:1; lowest is the brand
 *   green at 6.30:1 vs --paper).
 *
 * - Initials use var(--display) (Bricolage Grotesque, the brand display
 *   face) so they carry the same typographic register as the wordmark.
 *
 * TRADE-OFFS SURFACED (per house rules — no silent tech debt):
 *
 * 1. Plain <img>, NOT next/image, for the profile photo. next.config.ts has
 *    no `images.remotePatterns`, and this component must not edit it. In
 *    Next 16 `next/image` with a remote src whose host isn't allow-listed
 *    throws at runtime — so next/image is NOT "appropriate" here (the prompt's
 *    own qualifier). Avatars are 24–48px, where the optimiser buys ~nothing,
 *    and staying on <img> keeps the component self-contained and dependency-
 *    free. If `images.remotePatterns` is ever configured for the avatar
 *    host(s), swapping the <img> below for next/image is a localised change.
 *    `referrerPolicy="no-referrer"` avoids leaking the app URL to the avatar
 *    host, matching the product's privacy posture.
 *
 * 2. This is a server component (no "use client"), matching the rest of
 *    components/. Consequently a profile `image` that 404s / fails to load
 *    does NOT auto-fall back to initials — that needs an onError handler and
 *    thus a client boundary. Callers that can't trust the URL should resolve
 *    it (or pass null) before rendering, or wrap this in a thin client
 *    component that owns the fallback. Flagged, not hidden.
 *
 * 3. The empty-name safety net uses the English literal "User" for its
 *    accessible label. The component is intentionally i18n-free (pure, props
 *    only); the real accessible name is the user's actual `name`, which is
 *    already locale-agnostic. Callers with a non-empty name never hit this.
 */

type AvatarSize = "sm" | "md" | "lg";

interface UserAvatarProps {
  /** The user's display name. Drives initials, ground colour, and the
   *  accessible name. Whitespace-only / empty is tolerated (person glyph). */
  name: string;
  /** Profile image URL. When a non-empty string, it is rendered instead of
   *  initials. `null`/`undefined`/empty → initials. */
  image?: string | null;
  size?: AvatarSize;
  className?: string;
}

const SIZE_PX: Record<AvatarSize, number> = { sm: 24, md: 32, lg: 48 };

/**
 * Fixed, theme-stable grounds. See the header note on why these are hex and
 * not CSS vars, and why verdict/premium hues are excluded. Order is part of
 * the contract: changing it reshuffles existing users' colours.
 */
const PALETTE = [
  "#15181b", // graphite (Kenyan-flag black register / --ink light value)
  "#17241e", // forest night (--night-2)
  "#0b6b3e", // brand green, a shade deeper than the --true verdict swatch
  "#3b4650", // slate (near --status-slate)
  "#4a5560", // steel
  "#0f5159", // deep teal
  "#4a3b5c", // aubergine
  "#7a3b1f", // clay / soil (warm earthen Kenyan tone)
] as const;

/** Neutral ground for the unknown/empty-name case — reads as "no identity". */
const NEUTRAL_GROUND = "#4a5560";
const FOREGROUND = "#fafaf7"; // == --paper; >= 6.3:1 on every ground above

/** Deterministic djb2 string hash → non-negative integer. Pure, dep-free. */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    // eslint-disable-next-line no-bitwise -- classic djb2; `>>> 0` keeps it
    // an unsigned 32-bit int so the later `% PALETTE.length` is stable.
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * 1–2 uppercase initials: first letter of the first word + first letter of
 * the last word; a single word yields one letter. Returns null when no
 * letter can be derived (caller renders the person glyph). Uses Array.from so
 * a leading astral char (emoji, some scripts) counts as one grapheme-ish unit
 * rather than half a surrogate pair.
 */
function initialsFrom(trimmedName: string): string | null {
  if (trimmedName === "") return null;
  const words = trimmedName.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const firstWord = words[0];
  const lastWord = words[words.length - 1];
  const firstChar = Array.from(firstWord)[0] ?? "";
  const lastChar = words.length > 1 ? (Array.from(lastWord)[0] ?? "") : "";

  const initials = `${firstChar}${lastChar}`.trim();
  if (initials === "") return null;
  return initials.toLocaleUpperCase();
}

/** Minimal person glyph for the no-name case. Decorative (wrapper labels). */
function PersonGlyph({ size }: { size: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={FOREGROUND}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export function UserAvatar({
  name,
  image,
  size = "md",
  className,
}: UserAvatarProps): React.JSX.Element {
  const px = SIZE_PX[size];
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const accessibleName = trimmedName === "" ? "User" : trimmedName;
  const hasImage = typeof image === "string" && image.trim() !== "";

  const box: React.CSSProperties = {
    width: px,
    height: px,
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    overflow: "hidden",
    userSelect: "none",
    verticalAlign: "middle",
  };

  if (hasImage) {
    // See trade-off (1): plain <img>, intentionally not next/image.
    return (
      <img
        src={image as string}
        alt={accessibleName}
        width={px}
        height={px}
        className={className}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        style={{ ...box, objectFit: "cover" }}
      />
    );
  }

  const initials = initialsFrom(trimmedName);
  const ground =
    trimmedName === "" ? NEUTRAL_GROUND : PALETTE[hashString(trimmedName) % PALETTE.length];

  return (
    <span
      role="img"
      aria-label={accessibleName}
      className={className}
      style={{
        ...box,
        backgroundColor: ground,
        color: FOREGROUND,
        // Bricolage Grotesque — the brand display register (globals.css).
        fontFamily: "var(--display)",
        fontWeight: 600,
        // ~42% of the box reads well across 24/32/48 without overflow.
        fontSize: Math.round(px * 0.42),
        lineHeight: 1,
        letterSpacing: "0.02em",
      }}
    >
      {initials === null ? (
        <PersonGlyph size={Math.round(px * 0.72)} />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}
