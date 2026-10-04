import { getTranslations } from "next-intl/server";

/**
 * `/editor` is an INTERNAL, authenticated-only surface — never a public
 * destination (it is also absent from the primary nav for this reason).
 *
 * Real editor-session auth is NOT wired in the web app yet: ADR-0020
 * (Better Auth) is still pending and `services/api` exposes no
 * `/v1/editor/*` routes (see lib/editor-client.ts — that module is a
 * typed seam, not a live backend). Previously this route shipped a
 * pretend-logged-in editor rendering MOCK drafts from
 * `fixtures/editor-drafts.ts`, which is a dev stub that must not be
 * publicly reachable in production: a reader could mistake fixture rows
 * for a real moderation queue.
 *
 * Until a real session gate exists, this route renders an honest
 * "sign-in required" state and does NOT import the mock fixture or mount
 * the drafts panel. This deliberately avoids inventing a fake auth
 * boundary (a cookie check with no backend would look like real security
 * without being any). When ADR-0020 lands, branch here on the real
 * verified editor session and render the authenticated workspace only in
 * the signed-in case.
 */
export default async function EditorPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("editorial");
  return (
    <div className="shell flex flex-col gap-6">
      <h1>{t("heading")}</h1>
      <p className="form-note form-note-muted" role="status">
        {t("signInRequired.title")} — {t("signInRequired.body")}
      </p>
    </div>
  );
}
