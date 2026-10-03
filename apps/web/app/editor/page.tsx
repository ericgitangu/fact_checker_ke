import { getTranslations } from "next-intl/server";
import { EditorDraftsPanel } from "./editor-drafts-panel";

// TODO(auth): replace with real session check once ADR-0020 (Better Auth)
// lands — see docs/adr/0020-*.md. Until then this route is a dev-only
// stub behind a visible banner, not an authenticated editor surface. No
// cookie/session gate is enforced server-side here on purpose: adding a
// fake one would look like real auth and could be mistaken for a security
// boundary by a future reader. The banner is the honest alternative.
export const dynamic = "force-dynamic";

export default async function EditorPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("editorial");
  return (
    <div className="shell flex flex-col gap-6">
      <p className="editor-banner" role="status">
        {t("devBanner")}
      </p>
      <h1>{t("heading")}</h1>
      <EditorDraftsPanel />
    </div>
  );
}
