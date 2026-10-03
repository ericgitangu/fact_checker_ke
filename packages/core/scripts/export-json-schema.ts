/**
 * Exports every public contract schema in packages/core as a single JSON
 * Schema document with one `$defs` entry per schema (including enums), so
 * services/pipeline can generate matching Pydantic v2 models via
 * `datamodel-code-generator` (see `pnpm gen:contracts` at the repo root).
 *
 * zod (>= v4) is the single source of truth for these contracts. This
 * script never hand-edits or duplicates field definitions — it only walks
 * the already-defined zod schemas via `z.toJSONSchema`.
 *
 * ---------------------------------------------------------------------------
 * KNOWN GAP: JSON Schema cannot express zod `.refine()` / `.transform()`.
 * These are dropped silently by `z.toJSONSchema` (verified empirically: no
 * error, no warning — the constraint is just absent from the output). The
 * TS-only constraints below are NOT present in contracts.schema.json and
 * therefore NOT present in the generated Python models. Anything load-
 * bearing in that list must be re-implemented as a hand-written Pydantic
 * `@model_validator`/`@field_validator` subclass in
 * services/pipeline/app/models/domain.py (NEVER inside generated.py,
 * which is regenerated and overwritten on every `pnpm gen:contracts` run):
 *
 *   - SubmissionInputSchema: exactly one of `url` / `text` must be present
 *     (critical — mirrored as a Pydantic model_validator).
 *   - SubmissionInputSchema: `quote` / `timestampSec` are only valid on a
 *     `url` submission, never a `text` one (critical — mirrored).
 *   - WaitlistSignupInputSchema: `email` is `.trim()`-ed and
 *     `.toLowerCase()`-ed before the `.email()` format check. This is a
 *     normalization transform, not a validation constraint — there is no
 *     rejected input to mirror, so it is NOT re-implemented in Python; any
 *     caller of the generated model must normalize the email itself before
 *     constructing it if case/whitespace-insensitive comparison matters.
 * ---------------------------------------------------------------------------
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { ClaimSchema } from "../src/schemas/claim.js";
import { CheckSchema } from "../src/schemas/check.js";
import { DemonstrationSchema, DemonstrationStatusSchema } from "../src/schemas/demonstration.js";
import { ClaimTypeSchema, RatingSchema } from "../src/schemas/rating.js";
import { CredibilityTierSchema, SourceSchema } from "../src/schemas/source.js";
import {
  SubmissionInputSchema,
  SubmissionSchema,
  SubmissionStatusSchema,
} from "../src/schemas/submission.js";
import {
  WaitlistSignupInputSchema,
  WaitlistSignupResultSchema,
  WaitlistSourceSchema,
} from "../src/schemas/waitlist.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Every exported contract schema, keyed by the name it should receive as a
 * `$defs` entry. Listed alphabetically so the emitted document's key order
 * (and therefore its diff-ability) does not depend on import order — this
 * object's insertion order IS iteration order in JS, so keeping the source
 * alphabetical keeps `contracts.schema.json` stable across edits.
 */
const CONTRACT_SCHEMAS = {
  Check: CheckSchema,
  Claim: ClaimSchema,
  ClaimType: ClaimTypeSchema,
  CredibilityTier: CredibilityTierSchema,
  Demonstration: DemonstrationSchema,
  DemonstrationStatus: DemonstrationStatusSchema,
  Rating: RatingSchema,
  Source: SourceSchema,
  Submission: SubmissionSchema,
  SubmissionInput: SubmissionInputSchema,
  SubmissionStatus: SubmissionStatusSchema,
  WaitlistSignupInput: WaitlistSignupInputSchema,
  WaitlistSignupResult: WaitlistSignupResultSchema,
  WaitlistSource: WaitlistSourceSchema,
} as const satisfies Record<string, z.ZodType>;

/**
 * Drops a `default` keyword that sits *alongside* a bare `$ref` on an
 * object property, e.g. `{ default: "site", $ref: "#/$defs/WaitlistSource" }`
 * (this is exactly what `WaitlistSignupInputSchema.source` — a
 * `z.enum(...).default("site")` — produces).
 *
 * Why: `datamodel-code-generator` (verified empirically against the real
 * output, not deduced) resolves the `$ref` for the field's *type*
 * (`WaitlistSource | None`) but then emits the sibling `default` value
 * verbatim as a raw JSON literal (`= 'site'`) instead of the enum member
 * (`= WaitlistSource.site`) — a type mismatch mypy strict rejects
 * (`error: Incompatible types in assignment`). This is a real bug in that
 * tool's $ref+default handling, not a zod or JSON Schema problem (the
 * `required` array already correctly excludes `source`, so the field
 * still behaves as optional either way).
 *
 * Dropping `default` here only removes a documentation hint from the
 * schema — it does NOT change which fields are required. The real "site"
 * default is restored with the correct enum type in
 * services/pipeline/app/models/domain.py's `WaitlistSignupInput` subclass.
 */
function stripRefSiblingDefaults(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) stripRefSiblingDefaults(child);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if ("default" in obj && "$ref" in obj) {
    delete obj.default;
  }
  for (const value of Object.values(obj)) {
    stripRefSiblingDefaults(value);
  }
}

function main(): void {
  // A fresh, local registry (never the shared `z.globalRegistry`) so this
  // script has no side effects on any schema object it imports.
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of Object.entries(CONTRACT_SCHEMAS)) {
    registry.add(schema, { id });
  }

  const { schemas } = z.toJSONSchema(registry, {
    uri: (id) => `#/$defs/${id}`,
    // "input" representation: a field with `.default(x)` is NOT required
    // (the caller may omit it), matching what these schemas actually
    // accept at the API boundary. The "output" (default) representation
    // marks defaulted fields as required, which describes the *parsed*
    // value, not the wire payload — wrong for generating request models.
    io: "input",
  });

  const defs: Record<string, unknown> = {};
  for (const id of Object.keys(CONTRACT_SCHEMAS).sort()) {
    const entry = schemas[id];
    if (!entry || typeof entry !== "object") {
      throw new Error(`z.toJSONSchema produced no entry for "${id}"`);
    }
    // Strip the per-entry $schema/$id that z.toJSONSchema adds to each
    // registry member — they belong once, at the document root, not on
    // every $defs entry.
    const { $schema: _schema, $id: _id, ...rest } = entry as Record<string, unknown>;
    // `io: "input"` (above) is needed for correct `required` arrays, but
    // as a side effect zod v4 drops `additionalProperties: false` from
    // every object schema in that mode (verified empirically — present
    // under `io: "output"`, absent under `io: "input"`). zod's own
    // runtime default is actually "strip unknown keys", not "reject
    // them" — stricter than both JSON Schema representations above. We
    // choose to re-add `additionalProperties: false` here so
    // datamodel-code-generator emits `extra="forbid"` Pydantic models:
    // rejecting unexpected fields at the pipeline's API boundary is
    // intentionally stricter than zod's "silently drop" behaviour (see
    // CLAUDE.md: "Validate all inputs at the system boundary").
    if (rest.type === "object" && !("additionalProperties" in rest)) {
      rest.additionalProperties = false;
    }
    stripRefSiblingDefaults(rest);
    defs[id] = rest;
  }

  const document = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://fact-checker.ke/schemas/contracts.schema.json",
    title: "fact_checker_ke contracts",
    description:
      "GENERATED FILE — DO NOT EDIT BY HAND. Produced from packages/core/src/schemas/*.ts " +
      "zod schemas by packages/core/scripts/export-json-schema.ts. Run `pnpm gen:contracts` " +
      "at the repo root to regenerate (also regenerates services/pipeline's Pydantic models).",
    $defs: defs,
  };

  const outPath = resolve(__dirname, "../generated/contracts.schema.json");
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  // eslint-disable-next-line no-console -- CLI script, not an app code path.
  console.log(`Wrote ${Object.keys(defs).length} schema(s) to ${outPath}`);
}

main();
