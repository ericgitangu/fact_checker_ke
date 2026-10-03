# @fact-checker-ke/brand

The **single source of the fact_checker_ke visual identity**: the FC·KE
gradient mark, the `<Wordmark>` lockup (mark + wordmark text + superscript
waving Kenyan flag), the shared UI icon set, and the light/dark `useTheme`
hook.

Both `apps/site` (Vite SPA) and `apps/web` (Next.js App Router) import this
package instead of keeping local copies. Before this package existed, the
two apps had drifted: `apps/site` had the polished mark, `apps/web` still
showed an old plain "fc" tile with no flag. This package exists so that
drift is structurally impossible going forward — there is nowhere else for
either app to get these components from.

## API

```tsx
import { Wordmark, BrandMark, WavingFlag, useTheme } from "@fact-checker-ke/brand";
import { SunIcon, MoonIcon, ExternalLinkIcon, ShieldCheckIcon } from "@fact-checker-ke/brand";

<Wordmark size="md" variant={theme} />
```

- **`<Wordmark size variant showText decorative className />`** — the full
  lockup. `size`: `"sm" | "md" | "lg"` (type scale + mark size). `variant`:
  `"light" | "dark" | "mono"` (text colour + whether the flag renders at
  all — `mono` omits it). `showText` (default `true`): render the
  "fact_checker_ke" text node. `decorative` (default `false`): when
  `showText` is `false` and the brand name is already conveyed by
  surrounding content (e.g. a footer sentence), marks the icon-only mark
  `aria-hidden` so it doesn't need its own accessible name.
- **`<BrandMark tone tile size className title />`** — the FC·KE geometric
  monogram alone, used by `<Wordmark>` internally and available standalone
  (e.g. favicons, OG images). `tone`: `"gradient" | "mono"`.
- **`<WavingFlag className title />`** — the animated Kenyan flag SVG
  (motion gated on `prefers-reduced-motion`), used as `<Wordmark>`'s
  superscript.
- **`SunIcon` / `MoonIcon` / `ExternalLinkIcon` / `ShieldCheckIcon`** — the
  shared UI icon set (lucide visual language, inlined path data — no
  `lucide-react` dependency).
- **`useTheme()`** → `[theme, toggle]` — resolves the initial theme (stored
  choice in `localStorage`, else OS `prefers-color-scheme`), keeps
  `<html data-theme>` in sync, and persists explicit toggles.

All components are framework-neutral React + one self-contained stylesheet
(`wordmark.css`, imported by `wordmark.tsx`) — no dependency on either app's
design-token system. Every component that uses hooks carries its own
`"use client"` directive, so this package drops straight into a Next.js App
Router Server Component tree without the consumer needing to re-declare it.

## Font parity (Bricolage Grotesque)

The wordmark text itself doesn't set a font family in this package — it
inherits whatever the host page's body/display font is — but the brand
contract is that **both apps load the same display typeface, Bricolage
Grotesque, at the same weights**, so the wordmark and surrounding headlines
read identically:

- **apps/site** (Vite, no build-time Google Fonts integration): loads it via
  a `<link>` to Google Fonts in `index.html`, bound to the same CSS custom
  property name (`--font-display`) the app's headings use.
- **apps/web** (Next.js): loads it via `next/font/google`'s
  `Bricolage_Grotesque` export (self-hosted at build time, `display: swap`,
  bound to a CSS variable), configured in `app/layout.tsx`.

Both loads request the **same family name and weight range** — only the
delivery mechanism differs (`<link>` vs. `next/font`), which is the
correct, idiomatic choice for each toolchain. If the two ever need to
diverge in weight/subset, update both call sites together and note why
here.

## Why this isn't shipped as prebuilt CSS-in-JS

`wordmark.css` ships as a plain stylesheet copied into `dist/` alongside
the compiled JS (see `build` in `package.json`), not inlined via a CSS-in-JS
library. Both consumers already have a working CSS pipeline (Vite's native
CSS handling; Next.js App Router's "import CSS in any component" support),
so a runtime styling library would be pure overhead. `apps/web`'s
`next.config.ts` lists this package in `transpilePackages` so Next's
bundler processes `wordmark.css` from this workspace package instead of
treating it as an opaque `node_modules` dependency.

## Testing

Unit tests live next to each component (`*.test.tsx`), using
`@testing-library/react` + `jsdom`, run via `vitest run` — mirrors the
`apps/site` test setup. There was no pre-existing dedicated test suite for
these components (they were previously only covered indirectly through
`apps/site`'s `App.test.tsx`); this package's tests are new, focused
coverage for each component's own contract.
