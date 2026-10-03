import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Offline — fact_checker_ke",
};

export default async function OfflinePage(): Promise<React.JSX.Element> {
  const t = await getTranslations("common");
  return (
    <div className="shell-narrow flex flex-col items-center justify-center gap-3 text-center">
      <h1>{t("offline.title")}</h1>
      <p style={{ maxWidth: "48ch", color: "var(--ink-2)" }}>{t("offline.body")}</p>
    </div>
  );
}
