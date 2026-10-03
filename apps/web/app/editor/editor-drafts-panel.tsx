"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Check } from "@fact-checker-ke/core";

interface DraftRow {
  check: Check;
}

type PanelState =
  | { status: "loading" }
  | { status: "loaded"; drafts: DraftRow[]; mock: boolean }
  | { status: "error"; message: string };

export function EditorDraftsPanel(): React.JSX.Element {
  const t = useTranslations("editorial");
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/editor/drafts")
      .then((res) => res.json())
      .then((body: { drafts: DraftRow[]; _mock: boolean }) => {
        if (!cancelled) setState({ status: "loaded", drafts: body.drafts, mock: body._mock });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Failed to load drafts." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function approve(checkId: string): Promise<void> {
    setPending(checkId);
    try {
      await fetch(`/api/editor/checks/${checkId}/publish`, { method: "POST" });
      setState((prev) =>
        prev.status === "loaded"
          ? { ...prev, drafts: prev.drafts.filter((d) => d.check.id !== checkId) }
          : prev,
      );
    } finally {
      setPending(null);
    }
  }

  if (state.status === "loading") {
    return <p style={{ color: "var(--ink-3)" }}>…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="form-note form-note-error" role="alert">
        {state.message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {state.mock && (
        <p className="form-note form-note-muted" role="status">
          Showing mock drafts — services/api has no live editor endpoint yet (see
          lib/editor-client.ts).
        </p>
      )}
      <h2 style={{ fontSize: "1.1rem" }}>{t("drafts.heading")}</h2>
      {state.drafts.length === 0 ? (
        <p style={{ color: "var(--ink-3)" }}>{t("drafts.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {state.drafts.map(({ check }) => (
            <li key={check.id} className="draft-row">
              <p className="checkcard-claim" style={{ fontSize: "1.1rem" }}>
                {check.summary}
              </p>
              <p style={{ fontSize: "0.85rem", color: "var(--ink-3)" }}>{t("noRatingToSubmitter")}</p>
              <ul className="source-list">
                {check.sources.map((source) => (
                  <li key={source.id}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="draft-row-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pending === check.id}
                  onClick={() => void approve(check.id)}
                >
                  {pending === check.id ? t("action.publishing") : t("action.approve")}
                </button>
                {/* Correct is a seam-only action in this wave: it needs a rating picker
                    UI (left as a documented stub — approve is the fully wired path). */}
                <button type="button" className="btn btn-ghost" disabled title="Not yet implemented in this wave">
                  {t("action.correct")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
