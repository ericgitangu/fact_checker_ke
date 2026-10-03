import { getTranslations } from "next-intl/server";
import { SubmitForm } from "./submit-form";

export default async function Home(): Promise<React.JSX.Element> {
  const t = await getTranslations("submit");
  return (
    <div className="shell-narrow flex flex-col items-center gap-10 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 style={{ fontFamily: "var(--sans-x)", fontSize: "clamp(2rem, 4.5vw, 3.2rem)" }}>
          {t("heading")}
        </h1>
        <p style={{ maxWidth: "46ch", color: "var(--ink-2)" }}>{t("lede")}</p>
      </div>
      <SubmitForm />
    </div>
  );
}
