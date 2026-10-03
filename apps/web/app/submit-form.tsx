"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getDeviceToken } from "../lib/device-token";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; id: string }
  | { status: "error"; message: string };

function randomIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older Safari);
  // not cryptographically strong, but this key only needs to be unique
  // per attempt, not unguessable.
  return `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function SubmitForm(): React.JSX.Element {
  const t = useTranslations("submit");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [quote, setQuote] = useState("");
  const [timestampSec, setTimestampSec] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );

  // ADR-0028: no offline submission queueing in Phase 0-1 — disable
  // submit with a clear message instead of silently queueing a claim
  // that might go stale by the time it actually sends.
  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setState({ status: "submitting" });
    try {
      const trimmedQuote = quote.trim();
      const parsedTimestamp = timestampSec.trim() === "" ? undefined : Number(timestampSec);
      const deviceToken = await getDeviceToken();
      const idempotencyKey = randomIdempotencyKey();

      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          ...(deviceToken ? { "x-device-token": deviceToken } : {}),
        },
        body: JSON.stringify({
          url,
          ...(trimmedQuote ? { quote: trimmedQuote } : {}),
          ...(parsedTimestamp !== undefined && Number.isFinite(parsedTimestamp)
            ? { timestampSec: parsedTimestamp }
            : {}),
        }),
      });
      if (res.status !== 202) {
        const body: unknown = await res.json().catch(() => ({}));
        const message =
          typeof body === "object" && body !== null && "message" in body
            ? String((body as { message: unknown }).message)
            : `Submission failed with status ${res.status}`;
        setState({ status: "error", message });
        return;
      }
      const body = (await res.json()) as { id: string };
      setState({ status: "success", id: body.id });
      router.push(`/submissions/${body.id}`);
    } catch {
      setState({ status: "error", message: t("error.network") });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-4" aria-describedby={isOffline ? "offline-note" : undefined}>
      {isOffline && (
        <p id="offline-note" className="form-note form-note-muted" role="status">
          {t("error.offline")}
        </p>
      )}

      <div className="field">
        <label htmlFor="url" className="field-label">
          {t("field.url")}
        </label>
        <input
          id="url"
          name="url"
          type="url"
          required
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="quote" className="field-label">
          {t("field.quote")}
        </label>
        <p className="field-help">{t("field.quoteHelp")}</p>
        <textarea
          id="quote"
          name="quote"
          rows={2}
          placeholder="&ldquo;...&rdquo;"
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="timestampSec" className="field-label">
          {t("field.timestamp")}
        </label>
        <input
          id="timestampSec"
          name="timestampSec"
          type="number"
          min={0}
          max={86_400}
          step={1}
          placeholder="e.g. 95"
          value={timestampSec}
          onChange={(e) => setTimestampSec(e.target.value)}
        />
      </div>

      <button type="submit" className="btn btn-primary" disabled={state.status === "submitting" || isOffline}>
        {state.status === "submitting" ? tCommon("action.submitting") : tCommon("action.submit")}
      </button>

      {state.status === "success" && (
        <p className="form-note form-note-success" role="status">
          {t("success")}
        </p>
      )}
      {state.status === "error" && (
        <p className="form-note form-note-error" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
