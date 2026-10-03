import { getTranslations } from "next-intl/server";

export default async function CheckNotFound(): Promise<React.JSX.Element> {
  const t = await getTranslations("check");
  return (
    <div className="shell-narrow flex flex-col items-center gap-3 text-center">
      <h1>{t("notFound.title")}</h1>
      <p style={{ color: "var(--ink-2)" }}>{t("notFound.body")}</p>
    </div>
  );
}
