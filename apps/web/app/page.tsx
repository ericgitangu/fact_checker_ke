import { getTranslations } from "next-intl/server";
import { SubmitForm } from "./submit-form";

export default async function Home(): Promise<React.JSX.Element> {
  const t = await getTranslations("submit");
  return (
    <div className="shell" style={{ maxWidth: 720, marginInline: "auto" }}>
      <div className="flex flex-col gap-3" style={{ marginBottom: 32 }}>
        <h1 className="font-expanded" style={{ fontSize: "clamp(2rem, 4.5vw, 3rem)" }}>
          {t("heading")}
        </h1>
        <p style={{ maxWidth: "52ch", color: "var(--ink-2)" }}>{t("lede")}</p>
      </div>
      <SubmitForm />
    </div>
  );
}
