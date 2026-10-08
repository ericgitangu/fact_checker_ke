import { getTranslations } from "next-intl/server";
import { EditorQueuePanel } from "./queue-panel";

/**
 * `/editor` is an INTERNAL, authenticated-only surface — never a public
 * destination (it is also absent from the primary nav for this reason).
 *
 * A dedicated web session (ADR-0020 Better Auth) is still pending, so this page
 * does NOT fake a cookie gate that would look like security without being any.
 * Instead it defers auth entirely to the REAL boundary that already exists:
 * `services/api`'s `/v1/editor/*` routes, each gated by
 * `requireRole(["editor","admin"])` on an `Authorization: Bearer` session
 * token. The `EditorQueuePanel` client component takes that token and sends it
 * straight to the API, which is the sole authority on every action.
 *
 * ADR-0038: the queue the panel loads (`GET /v1/editor/queue`) is now the
 * BOUNDED escalation queue — only `lifecycle_state = 'editor_review'`, not
 * "every draft" — so a founder sees only items escalated by community
 * source-weight, virality, or an explicit pull, never the whole autonomous
 * preliminary/awaiting_sources backlog.
 *
 * `API_BASE_URL` is read server-side (same default as lib/get-feed.ts) and
 * passed to the client panel; the browser never needs a public env var.
 */
export default async function EditorPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("editorial");
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  return (
    <div className="shell flex flex-col gap-6">
      <h1>{t("heading")}</h1>
      <p className="form-note form-note-muted" role="status">
        {t("signInRequired.title")} — {t("signInRequired.body")}
      </p>
      <EditorQueuePanel apiBaseUrl={apiBaseUrl} />
    </div>
  );
}
