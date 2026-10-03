"use client";

import { useState, type FormEvent } from "react";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; id: string }
  | { status: "error"; message: string };

export function SubmitForm(): React.JSX.Element {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setState({ status: "submitting" });
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
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
    } catch {
      setState({ status: "error", message: "Network error — please try again." });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-3">
      <label htmlFor="url" className="text-sm font-medium">
        Link to a claim, video or article
      </label>
      <input
        id="url"
        name="url"
        type="url"
        required
        placeholder="https://..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        disabled={state.status === "submitting"}
        className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {state.status === "submitting" ? "Submitting..." : "Check this"}
      </button>
      {state.status === "success" && (
        <p className="text-sm text-green-700 dark:text-green-400">
          Submitted. Track progress at{" "}
          <a className="underline" href={`/checks/${state.id}`}>
            /checks/{state.id}
          </a>
          .
        </p>
      )}
      {state.status === "error" && (
        <p className="text-sm text-red-700 dark:text-red-400">{state.message}</p>
      )}
    </form>
  );
}
