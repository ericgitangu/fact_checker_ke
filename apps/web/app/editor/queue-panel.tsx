"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * The minimal editor review queue (ADR-0025 §2 surface). Lists held,
 * unpublished drafts and lets an editor Approve (publish) or Dismiss
 * (terminally close) each one.
 *
 * AUTH — reuses the EXISTING API boundary, invents nothing. `services/api`
 * already gates every `/v1/editor/*` route with `requireRole(["editor",
 * "admin"])` reading an `Authorization: Bearer <session token>` header
 * (services/api/src/lib/auth/middleware.ts). The web app has no session of
 * its own yet (ADR-0020 Better Auth is still pending — see page.tsx), so
 * rather than fake a cookie gate that LOOKS like security without being
 * any, this panel takes the editor's real API session token and sends it
 * straight to that real gate. The token never leaves the browser except as
 * the bearer header to the fact-check API; the API is the sole authority on
 * whether any action is allowed. When ADR-0020 lands, swap this field for
 * the real web session and keep the same calls.
 */
interface HeldCheck {
  checkId: string;
  submissionId: string;
  summary: string;
  rating: string | null;
  riskTier: "A" | "B" | "C" | null;
  viralityScore: number | null;
  createdAt: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; items: HeldCheck[] }
  | { kind: "error"; message: string };

const TOKEN_KEY = "editor-session-token";

function readStoredToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function EditorQueuePanel({ apiBaseUrl }: { apiBaseUrl: string }): React.JSX.Element {
  const t = useTranslations("editorial");
  const base = apiBaseUrl.replace(/\/$/, "");

  const [token, setToken] = useState<string>(readStoredToken);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const authHeaders = useCallback(
    (): HeadersInit => ({ authorization: `Bearer ${token.trim()}` }),
    [token],
  );

  const load = useCallback(async () => {
    setNotice(null);
    setPhase({ kind: "loading" });
    try {
      sessionStorage.setItem(TOKEN_KEY, token.trim());
    } catch {
      // sessionStorage unavailable (private mode) — the token still works
      // for this mount, it just won't be remembered across reloads.
    }
    try {
      const res = await fetch(`${base}/v1/editor/checks`, { headers: authHeaders() });
      if (res.status === 401 || res.status === 403) {
        setPhase({ kind: "error", message: t("queue.authError") });
        return;
      }
      if (!res.ok) {
        setPhase({ kind: "error", message: t("queue.loadError") });
        return;
      }
      const body = (await res.json()) as { items: HeldCheck[] };
      setPhase({ kind: "loaded", items: body.items });
    } catch {
      setPhase({ kind: "error", message: t("queue.loadError") });
    }
  }, [base, token, authHeaders, t]);

  const act = useCallback(
    async (checkId: string, action: "approve" | "reject", successMsg: string) => {
      setNotice(null);
      setBusyId(checkId);
      try {
        const res = await fetch(`${base}/v1/editor/checks/${encodeURIComponent(checkId)}/${action}`, {
          method: "POST",
          headers: { ...authHeaders(), "content-type": "application/json" },
          body: "{}",
        });
        if (!res.ok) {
          setNotice(res.status === 401 || res.status === 403 ? t("queue.authError") : t("queue.actionError"));
          return;
        }
        // Drop the actioned row locally — the server has moved it out of the
        // held-draft set, so a re-fetch would return the same without it.
        setPhase((prev) =>
          prev.kind === "loaded" ? { kind: "loaded", items: prev.items.filter((i) => i.checkId !== checkId) } : prev,
        );
        setNotice(successMsg);
      } catch {
        setNotice(t("queue.actionError"));
      } finally {
        setBusyId(null);
      }
    },
    [base, authHeaders, t],
  );

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <div className="field">
          <label htmlFor="editor-token" className="field-label">
            {t("queue.tokenLabel")}
          </label>
          <input
            id="editor-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <p className="field-help">{t("queue.tokenHint")}</p>
        </div>
        <button type="submit" className="btn btn-primary" disabled={!token.trim() || phase.kind === "loading"}>
          {phase.kind === "loading" ? t("queue.loading") : t("queue.load")}
        </button>
      </form>

      {notice && (
        <p className="form-note form-note-success" role="status">
          {notice}
        </p>
      )}

      {phase.kind === "error" && (
        <p className="form-note form-note-error" role="alert">
          {phase.message}
        </p>
      )}

      {phase.kind === "loaded" && (
        <section aria-labelledby="queue-heading" className="flex flex-col gap-3">
          <h2 id="queue-heading">{t("drafts.heading")}</h2>
          {phase.items.length === 0 ? (
            <p className="form-note form-note-muted" role="status">
              {t("drafts.empty")}
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {phase.items.map((item) => (
                <li key={item.checkId} className="trendingcard">
                  <div className="trendingcard-head">
                    {item.rating && <span className="platform-badge">{item.rating}</span>}
                    {item.riskTier && (
                      <span className="platform-badge">
                        {t("queue.riskTier")} {item.riskTier}
                      </span>
                    )}
                    {item.viralityScore !== null && (
                      <span className="platform-badge">
                        {t("queue.reach")} {Math.round(item.viralityScore)}
                      </span>
                    )}
                  </div>
                  <p className="trendingcard-title">{item.summary}</p>
                  <div className="submit-cta-row flex gap-3">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busyId === item.checkId}
                      onClick={() => void act(item.checkId, "approve", t("queue.approved"))}
                    >
                      {busyId === item.checkId ? t("action.publishing") : t("action.approve")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busyId === item.checkId}
                      onClick={() => void act(item.checkId, "reject", t("queue.dismissed"))}
                    >
                      {busyId === item.checkId ? t("action.dismissing") : t("action.dismiss")}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
