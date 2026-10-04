import type { TwoEngineFlowCopy, VerdictScaleCopy } from "@fact-checker-ke/brand";

/**
 * Builds the localised copy objects for the two shared brand set pieces
 * (<VerdictScale>, <TwoEngineFlow>) from the `brand` i18n namespace.
 *
 * Both the landing (`app/page.tsx`) and the methodology page render these
 * set pieces with the same Swahili/English copy, so the key-mapping lives
 * here once instead of being duplicated per page. Pass a translator scoped
 * to the `brand` namespace (`getTranslations("brand")` /
 * `useTranslations("brand")`).
 */
export type BrandTranslator = (key: string) => string;

export function buildScaleCopy(tb: BrandTranslator): VerdictScaleCopy {
  return {
    true: { name: tb("scale.true.name"), description: tb("scale.true.description") },
    mostly: { name: tb("scale.mostly.name"), description: tb("scale.mostly.description") },
    misleading: {
      name: tb("scale.misleading.name"),
      description: tb("scale.misleading.description"),
    },
    false: { name: tb("scale.false.name"), description: tb("scale.false.description") },
    unproven: { name: tb("scale.unproven.name"), description: tb("scale.unproven.description") },
    notcheckable: {
      name: tb("scale.notcheckable.name"),
      description: tb("scale.notcheckable.description"),
    },
  };
}

export function buildFlowCopy(tb: BrandTranslator): TwoEngineFlowCopy {
  return {
    entriesLabel: tb("flow.entriesLabel"),
    stepsLabel: tb("flow.stepsLabel"),
    entries: {
      fetch: { tag: tb("flow.fetch.tag"), title: tb("flow.fetch.title"), body: tb("flow.fetch.body") },
      submit: {
        tag: tb("flow.submit.tag"),
        title: tb("flow.submit.title"),
        body: tb("flow.submit.body"),
      },
    },
    steps: {
      extract: { title: tb("flow.steps.extract.title"), body: tb("flow.steps.extract.body") },
      ground: { title: tb("flow.steps.ground.title"), body: tb("flow.steps.ground.body") },
      assess: { title: tb("flow.steps.assess.title"), body: tb("flow.steps.assess.body") },
      publish: { title: tb("flow.steps.publish.title"), body: tb("flow.steps.publish.body") },
      audit: { title: tb("flow.steps.audit.title"), body: tb("flow.steps.audit.body") },
    },
  };
}
