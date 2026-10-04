import { PRIVACY_SECTIONS } from "@fact-checker-ke/core";
import { LegalPage } from "./legal-page";

export function PrivacyPage(): React.JSX.Element {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="How fact_checker_ke collects, uses, and retains data during the pilot."
      sections={PRIVACY_SECTIONS}
    />
  );
}
