import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline — fact_checker_ke",
};

export default function OfflinePage(): React.JSX.Element {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        fact_checker_ke couldn&apos;t reach the network. The app shell is cached, so
        pages you&apos;ve already visited may still work — reconnect to submit a new
        claim or load fresh checks.
      </p>
    </main>
  );
}
