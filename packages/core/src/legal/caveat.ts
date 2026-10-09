/**
 * ADR-0033: legal caveat, Terms & Conditions, Privacy Policy and indemnity
 * framework — wired in here as a STARTER DRAFT, explicitly NOT legal advice
 * and NOT a finished legal shield.
 *
 * **Everything in this file is draft copy pending a Kenyan advocate's
 * sign-off (ADR-0008/0033).** It is deliberately a plain exported constant
 * object, NOT a zod schema/contract: per the ADR-0033 implementation brief,
 * this text must stay freely revisable by legal without a schema-driven
 * code change, it is not part of the JSON-Schema/Pydantic contract export
 * (`packages/core/generated/**`, `services/pipeline/app/models/generated.py`)
 * and `pnpm run gen:schema` / `gen-contracts` must never be run against it.
 *
 * `ADVOCATE_SIGNOFF_COMPLETE` is the ADR-0033 AT-0033-2 gate flag. It is
 * hardcoded `false` here (no advocate has signed off at the time of this
 * scaffolding pass) — flipping it to `true` is an explicit, advocate-led
 * decision, not a deploy-time env toggle, so it lives in code review rather
 * than infra config. Every surface that renders this copy must read this
 * flag and render the "DRAFT — pending advocate review" state whenever it
 * is `false`, per ADR-0033 Review triggers.
 */

/** ADR-0033 AT-0033-2 gate. See file header — advocate-led flip only. */
export const ADVOCATE_SIGNOFF_COMPLETE = false as const;

/**
 * ADR-0033 §A short-form standing caveat — verbatim from the ADR, shown on
 * EVERY published assessment's card/badge/embed and in every outbound post
 * (ADR-0003/0023), regardless of risk tier. Snapshot-tested
 * (`packages/core/src/__tests__/legal-caveat.test.ts`) so the wording
 * cannot silently regress (AT-0033-1).
 */
export const STANDING_CAVEAT_SHORT = {
  heading: "AI-assisted assessment · pilot · not a verdict on any person.",
  body:
    "We assess the claim, not the person. This is a confidence-weighted, " +
    "AI-generated analysis for research and educational purposes, " +
    "published in a pilot stage. It is not a statement of fact about any " +
    "individual, not legal or professional advice, and carries no " +
    "warranty of accuracy or completeness. Sources are cited; confidence " +
    "is shown. If you are named here, you have a right of reply and " +
    "correction.",
} as const;

/**
 * ADR-0033 §A long-form caveat elements ("About this assessment /
 * methodology"). One `[ADVOCATE: ...]` marker is carried over verbatim
 * (the research/educational-vs-credibility tension) — it must render as a
 * visible open question, never be silently resolved.
 */
export const STANDING_CAVEAT_LONG = [
  {
    id: "ai-generated",
    heading: "AI-generated & confidence-weighted",
    body:
      "Produced by automated analysis; the confidence figure is the " +
      "published weight (ADR-0031), not a guarantee; “what would " +
      "change this” is shown.",
  },
  {
    id: "claim-attributed",
    heading: "Claim-attributed, never person-indicting",
    body:
      "Framing per ADR-0023/0031 (Tier C = open-question). We follow an " +
      "Africa-Check-style process and a PesaCheck-style " +
      "“[VERDICT]: [claim] — [why]” headline; we rate " +
      "claims, not people (ADR-0008 §4).",
  },
  {
    id: "research-educational",
    heading: "Research/educational purpose, no reliance warranty",
    body: "",
    advocateMarker:
      "[ADVOCATE: confirm this framing does not itself defeat the " +
      "product's credibility while still limiting liability — the " +
      "ADR-0031 tension.]",
  },
  {
    id: "pilot-stage",
    heading: "Pilot stage",
    body:
      "Methods and calibration are still being proven (ADR-0031 quality " +
      "ramp); error rates are non-zero and disclosed.",
  },
  {
    id: "sources-right-of-reply",
    heading: "Sources & right of reply",
    body:
      "Every assessment links its sources and an archived evidence file " +
      "(ADR-0008); named persons get a right-of-reply and correction " +
      "path (async for auto-published Tier A/B, pre-publish for " +
      "stricter Tier C modes).",
  },
] as const;

/**
 * ADR-0033 §E: Tier-C assessments render claim-attributed open-question
 * framing inline, IN ADDITION TO the standing caveat — never a declarative
 * person-directed statement (AT-0033-4).
 */
export const TIER_C_INLINE_CAVEAT = {
  body:
    "The evidence we found does not support this claim as stated — " +
    "here is why. The named person has a right of reply and correction.",
} as const;

/**
 * AT-0033-4 regression guard: phrases that must never appear as rendered
 * copy anywhere this caveat/framing is shown. Deliberately a small,
 * literal list of the worst-case person-indicting pattern named in the
 * ADR's own acceptance test text, not a restatement of
 * `packages/core/src/schemas/guidance.ts`'s broader
 * `isBareIndictmentFraming` lexical guard (which governs published `Check`
 * summaries, a schema this file must not touch). Tests exercise both.
 */
export const BANNED_PERSON_INDICTING_PHRASES = ["lied", "is a liar"] as const;

/**
 * AT-0033-5 regression guard: the corrected framing reference (ADR-0033
 * Context) is Africa-Check-style process + PesaCheck-style headline. This
 * string (and no CNN Facts First rating-scale reference) must never appear
 * in product copy.
 */
export const BANNED_FRAMING_REFERENCES = ["CNN Facts First rating scale"] as const;

/**
 * ADR-0033 §C.3 — the ADR-0021 cross-border disclosure, carried verbatim
 * so the Privacy Policy page states exactly this sentence (AT-0033-6).
 */
export const EU_CROSS_BORDER_DISCLOSURE =
  "Your submission is processed on servers in the European Union." as const;

/**
 * ADR-0033 §C.2 — mirrors the ADR-0021 retention table (one row per data
 * class, `retentionDays: null` = indefinite). Duplicated here as plain
 * draft-copy data, deliberately NOT re-exported from or coupled to
 * `packages/core/src/schemas/retention.ts` (out of this change's
 * ownership) — if the two drift, `db/migrations/0006_seed_retention_policy.sql`
 * is the source of truth and this copy must be updated to match.
 */
export const PRIVACY_RETENTION_CLASSES = [
  { dataClass: "Submissions (no claim found, unpublished)", retentionDays: 30 },
  { dataClass: "Drafts naming a person (unpublished)", retentionDays: 90 },
  { dataClass: "Published checks + evidence files", retentionDays: null },
  { dataClass: "Waitlist / newsletter signups", retentionDays: 730 },
  // DPA 2019 s.29/s.39: "Sign in with Google" early-adopter roster — email,
  // display name and avatar URL from the Google profile, plus first/last-seen
  // timestamps, written on each login (packages/db `early_adopters`). Retained
  // for 2y keyed to last_seen_at (purge older), matching the waitlist class.
  { dataClass: "Sign-in profile (Google: email, name, avatar)", retentionDays: 730 },
  { dataClass: "Uploads (photos/audio, EXIF stripped at ingest)", retentionDays: 1 },
  { dataClass: "Application logs (Cloud Run, Vercel)", retentionDays: 30 },
  { dataClass: "Tracker-route logs (/maandamano/*, IP redacted)", retentionDays: 7 },
  { dataClass: "Audit log", retentionDays: null },
] as const;
export type PrivacyRetentionClass = (typeof PRIVACY_RETENTION_CLASSES)[number];

/**
 * ADR-0033 §B — Terms & Conditions structure, as reviewable data. Every
 * `advocateMarker` is an open `[ADVOCATE: ...]` question from the ADR and
 * MUST render as a visible "pending legal review" marker on the page — see
 * `apps/web/app/terms/page.tsx`.
 */
export const TERMS_SECTIONS = [
  {
    id: "who-we-are",
    heading: "Who we are / pilot status",
    body:
      "fact_checker_ke is operated as a pilot. Our ODPC registration " +
      "status and legal entity details are being finalised; this is " +
      "stated up front, not buried.",
  },
  {
    id: "nature-of-service",
    heading: "Nature of the service",
    body:
      "AI-assisted, confidence-weighted, claim-attributed assessments for " +
      "research and education. This is NOT professional, legal, " +
      "financial, electoral or journalistic advice to act on.",
    advocateMarker: "[ADVOCATE: journalism/DPA s.52 interaction, ADR-0008 Q4.]",
  },
  {
    id: "no-warranty",
    heading: "No warranty",
    body:
      "The service is provided “as is”, with no warranty of " +
      "accuracy, completeness, fitness for a particular purpose, or " +
      "non-infringement, to the extent permitted by Kenyan law.",
    advocateMarker:
      "[ADVOCATE: Consumer Protection Act 2012 limits on “as is” for a free service.]",
  },
  {
    id: "acceptable-use",
    heading: "Acceptable use",
    body:
      "You may not use our assessments to harass, defame, or incite. No " +
      "scraping or redistribution beyond the cited-and-linked terms we " +
      "publish them under.",
  },
  {
    id: "user-submitted-content",
    heading: "User-submitted content",
    body:
      "If you submit a claim, link, or media for fact-checking, you " +
      "warrant that you have the right to submit it. You indemnify us " +
      "against claims arising from your submission (for example, a " +
      "fabricated quote or an infringing upload).",
    advocateMarker: "[ADVOCATE: enforceability of an indemnity from an anonymous/free user.]",
  },
  {
    id: "limitation-of-liability",
    heading: "Limitation of liability",
    body:
      "Our aggregate liability toward users of this free pilot is " +
      "capped, to the extent Kenyan law permits. This limitation runs to " +
      "users of the service under these Terms — it does NOT limit, " +
      "and cannot limit, any claim by a third party who is not a party " +
      "to these Terms (see the Privacy Policy's “What this does not " +
      "do” section and ADR-0033 Residual risk).",
    advocateMarker:
      "[ADVOCATE: a free pilot's cap; whether Kenyan law permits excluding liability for " +
      "content we ourselves publish — this is the clause least likely to hold for our " +
      "OWN auto-published defamation.]",
  },
  {
    id: "right-of-reply",
    heading: "Right of reply, correction & takedown",
    body:
      "If you are named in a published assessment, you have a right of " +
      "reply and correction, and a takedown/complaint path, as described " +
      "in our methodology page.",
  },
  {
    id: "governing-law",
    heading: "Governing law & dispute resolution",
    body: "These Terms are governed by the laws of Kenya.",
    advocateMarker: "[ADVOCATE: forum for dispute resolution.]",
  },
  {
    id: "changes-and-termination",
    heading: "Changes & pilot termination",
    body:
      "We may change these Terms or end the pilot. We will notify users " +
      "of material changes.",
  },
] as const;
export type TermsSection = (typeof TERMS_SECTIONS)[number];

/**
 * ADR-0033 §C — Privacy Policy structure, as reviewable data.
 */
export const PRIVACY_SECTIONS = [
  {
    id: "controller-identity",
    heading: "Controller identity & DPO contact",
    body:
      "Our controller identity and Data Protection Officer contact are " +
      "being finalised as part of ODPC registration (ADR-0008 §2).",
  },
  {
    id: "what-we-collect",
    heading: "What we collect, per data class",
    body:
      "The table below mirrors our data-retention policy (ADR-0021): " +
      "what we collect and how long we keep it, per data class.",
    retentionTable: PRIVACY_RETENTION_CLASSES,
  },
  {
    id: "sign-in",
    heading: "Signing in with Google",
    body:
      "Signing in is optional — it is only required to submit a claim or add " +
      "a source; browsing, reading verdicts and the maandamano tracker need no " +
      "account. We use Google Sign-In and, from your Google profile, store your " +
      "email, display name and avatar to recognise you and to keep early " +
      "adopters informed about the pilot. We never receive your Google " +
      "password and request only basic profile scopes (email, profile). You can " +
      "ask us to delete this record at any time.",
    advocateMarker:
      "[ADVOCATE: confirm lawful basis for storing the Google Sign-In profile " +
      "+ early-adopter contact under DPA 2019 s.29/s.30.]",
  },
  {
    id: "cross-border-transfer",
    heading: "Cross-border transfer",
    body: EU_CROSS_BORDER_DISCLOSURE,
    advocateMarker: "[ADVOCATE: DPA Part VI basis — SCCs/adequacy/consent.]",
  },
  {
    id: "training-moat-consent",
    heading: "Using your data to improve our models",
    body:
      "Separately from submitting a claim, we may ask for your specific, " +
      "opt-in consent to retain and use your submissions, corrections, " +
      "and agree/dispute signals to improve and train our models. This " +
      "consent is granular and severable from the act of submitting — " +
      "you can submit a claim without granting it, and you can revoke it " +
      "at any time (see “Your rights” below, which routes to our " +
      "data-subject-access-request process). Protest-related or other " +
      "special-category content is excluded from training by default.",
    advocateMarker:
      "[ADVOCATE: can a free service condition submission on training consent, or must it " +
      "be optional? Also: honesty about human review of training data.]",
  },
  {
    id: "minimisation",
    heading: "Minimisation",
    body:
      "We do not collect GPS location or sync your contacts. IPs for " +
      "`/maandamano/*` requests are redacted at ingest.",
  },
  {
    id: "your-rights",
    heading: "Your rights (DSAR) & law enforcement",
    body:
      "You can request a copy or deletion of your data. We do not " +
      "release data to law enforcement without a Kenyan court order or a " +
      "written statutory request, verified and logged.",
  },
  {
    id: "published-checks-not-erasable",
    heading: "Published checks are not erasable",
    body:
      "A published check and its evidence file are not deleted in " +
      "response to an erasure request — they are the justification " +
      "(defence) record for what we published, and they outlive erasure " +
      "requests.",
  },
  {
    id: "what-this-does-not-do",
    heading: "What this policy does not do",
    body:
      "An indemnity from users, and a limitation of our liability toward " +
      "users, do not run to a third party we write about. A named " +
      "individual we publish an assessment about is not a party to these " +
      "Terms and is not bound by our liability cap or by any user's " +
      "indemnity. Their claim, if any, sounds in defamation — this " +
      "Privacy Policy and the Terms reduce, but do not eliminate, that " +
      "exposure (see our methodology page and ADR-0033's Residual risk " +
      "section).",
  },
] as const;
export type PrivacySection = (typeof PRIVACY_SECTIONS)[number];
