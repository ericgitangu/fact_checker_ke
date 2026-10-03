/**
 * Import mechanism note (DEVIATION from the original plan — recorded
 * here and in the ADR implementation notes): Terraform's declarative
 * `import {}` block syntax supports a conditional `for_each` only from
 * 1.11 onward. This stack is pinned to exactly 1.5.7 (ADR-0016), which
 * supports `import {}` blocks but NOT `for_each`/`count` on them —
 * EMPIRICALLY VERIFIED this session: `terraform init` on a `for_each`-
 * gated import block fails with "Unsupported argument: An argument
 * named \"for_each\" is not expected here." on 1.5.7.
 *
 * Because the Neon and Upstash resources are themselves gated behind
 * enable_neon_import/enable_upstash_import (so a plan without
 * NEON_API_KEY still succeeds), a static (non-conditional) import block
 * would reference a resource instance that doesn't exist whenever the
 * gate is false, which also errors.
 *
 * Resolution: import is done with the classic imperative
 * `terraform import <address> <id>` CLI command instead — fully
 * supported on 1.5.7, and naturally "conditional" because you simply
 * don't run it until the gate is flipped true. Run once per resource,
 * after setting enable_*_import = true in a `-var` or tfvars file:
 *
 *   terraform import 'module.upstash.upstash_redis_database.this[0]' \
 *     2fee57b0-0650-4a67-bdc9-4ce3e4ad4dc1
 *
 *   terraform import 'module.neon.neon_project.this[0]' \
 *     ancient-art-69043280
 *   terraform import 'module.neon.neon_branch.main[0]' \
 *     ancient-art-69043280/br-soft-mode-b1m57jj2
 *   terraform import 'module.neon.neon_branch.dev[0]' \
 *     ancient-art-69043280/br-square-hat-b1589ix2
 *
 * The Upstash import was executed in this session (see ADR-0016
 * implementation notes for the apply evidence). The Neon import is
 * [MANUAL] pending a NEON_API_KEY generated at
 * https://console.neon.tech/app/settings/api-keys.
 */
