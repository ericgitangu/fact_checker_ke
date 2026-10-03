import { SubmitForm } from "./submit-form";

export default function Home(): React.JSX.Element {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-8 px-6 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">fact_checker_ke</h1>
        <p className="max-w-xl text-zinc-600 dark:text-zinc-400">
          Submit a link or paste text. We transcribe, extract claims, run retrieval
          against known sources, and draft a verdict — always reviewed by a human
          before it is published.
        </p>
      </div>
      <SubmitForm />
    </main>
  );
}
