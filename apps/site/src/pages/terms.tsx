import { TERMS_SECTIONS } from "@fact-checker-ke/core";
import { LegalPage } from "./legal-page";

export function TermsPage(): React.JSX.Element {
  return (
    <LegalPage
      title="Terms & Conditions"
      intro="These Terms govern your use of the fact_checker_ke pilot. Read them alongside our Privacy Policy and methodology page."
      sections={TERMS_SECTIONS}
    />
  );
}
