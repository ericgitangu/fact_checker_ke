import { demonstrations } from "../../fixtures/demonstrations";

export default function MaandamanoPage(): React.JSX.Element {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Maandamano advisories</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Read-only advisories by ward / sub-county. No precise locations are
          published.
        </p>
      </div>
      <ul className="flex flex-col gap-4">
        {demonstrations.map((demo) => (
          <li key={demo.id} className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{demo.title}</h2>
              <span className="rounded bg-zinc-100 px-2 py-1 text-xs capitalize dark:bg-zinc-800">
                {demo.status}
              </span>
            </div>
            <p className="text-sm text-zinc-500">
              {demo.area}, {demo.county}
              {demo.date ? ` · ${demo.date}` : ""}
            </p>
            <p className="mt-2 text-sm">{demo.summary}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
