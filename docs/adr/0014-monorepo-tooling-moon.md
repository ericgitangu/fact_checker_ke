# ADR-0014: Monorepo tooling — moonrepo replaces Turborepo

**Status:** Accepted (option 2, owner, 2026-10-03) · **Date:** 2026-10-03 · Supersedes the Turborepo choice in ADR-0010's layout

## Problem
The repo is polyglot (TypeScript and Python), and will add Swift and Kotlin later through Expo modules. Turborepo only orchestrates JavaScript package scripts, so the Python pipeline, the codegen chain (zod → JSON Schema → Pydantic) and Docker builds sit outside its graph. That gap is how the API Dockerfile came to hard-code the dependency graph and break when `packages/db` landed.

## Evidence (verified 2026-10-03)
- moon's current major is **v2** (v2.3) **[V]**. Node/pnpm support is full **[V]**.
- **Python/uv support is experimental**, and there is an open polyglot bug where Python setup fails to locate Node (moonrepo/moon#2691) **[V]**.
- `moon docker scaffold`/`prune` exist (config keys renamed in v2), as do `moon ci` (affected-only runs) and `moon migrate from-turborepo` **[V]**.

## Options
1. **Keep Turborepo** and script around it for Python and Docker. The graph stays split.
2. **moon v2 with the Node toolchain managed, and Python tasks as plain command tasks that invoke `uv`.** Recommended.
3. **moon v2 with the experimental Python toolchain.** Rejected for now because of #2691.
4. **Nx or Bazel.** Heavier, with no named gap over moon for this repo.

## Decision (proposed): Option 2
- `.moon/workspace.yml`: projects `apps/*`, `packages/*`, `services/*`. Toolchain pins Node 24 and pnpm. **No Python toolchain.** The pipeline's tasks are `command: uv run …`, so moon caches by declared `inputs` and `outputs` without managing the interpreter.
- **Shared task inheritance** in `.moon/tasks/*.yml` (lint, typecheck, test, build), DRY across projects. A project only overrides what differs.
- **The codegen chain is a real graph edge.** `core:gen-contracts` outputs `packages/core/generated/**` and `services/pipeline/app/models/generated.py`. `pipeline:test` and `pipeline:typecheck` `deps: [core:gen-contracts]`. The drift gate is `moon run core:gen-contracts && git diff --exit-code`.
- **Docker:** Dockerfiles use `moon docker scaffold <project>` and `moon docker prune`, so the image build derives the dependency graph and never lists packages by hand. This replaces the interim `pnpm fetch` fix.
- **Env as task inputs:** build tasks declare env inputs (for example `$VITE_API_URL`) so cache keys change when config changes. Turbo had this gap.
- **CI and the pre-push hook run `moon ci`** (affected projects only).
- Remove `turbo.json` and turbo devDependencies. The root `package.json` scripts become thin `moon run` aliases, so muscle memory still works.

## Trade-offs accepted
- moon is less widely known than Turborepo.
- The Python interpreter isn't managed by moon. `uv` already pins it, so this is acceptable.

## Review trigger
Revisit when moon#2691 is fixed and Python is stable, at which point we adopt the Python toolchain. Also revisit if `moon docker scaffold` mishandles the pnpm workspace.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0014-1 | `moon ci` on a clean tree runs lint, typecheck, test and build for every project, and passes | GREEN |
| AT-0014-2 | Touching `packages/core/src` makes `moon query projects --affected` include core, db, api, web, site and pipeline | GREEN |
| AT-0014-3 | Adding a new workspace package used by the API requires **no Dockerfile edit**, and the image still builds | GREEN (see Implementation notes — scoped to one `dependsOn` line in `moon.yml`, not the Dockerfile) |
| AT-0014-4 | Changing `VITE_API_URL` invalidates the `site:build` cache | GREEN |
| AT-0014-5 | The drift gate fails when a zod enum changes without regenerating | GREEN |

## Implementation notes (2026-10-03)

Implemented on top of `docs/adr/0013-0019-platform`. moon **v2.5.6** (`@moonrepo/cli`, installed as a root devDependency so `pnpm install` provisions it for every contributor; a v2.3.5 standalone binary was already present from an earlier manual install and used for initial exploration — both are the same v2 config format).

**Config layout** (`.moon/workspace.yml`, `.moon/toolchains.yml` — plural, v2 renamed this from v1's `toolchain.yml` — `.moon/tasks/node.yml`, and a `moon.yml` per project): `projects: ['apps/*', 'packages/*', 'services/*']` (glob discovery, so `pipeline` is picked up from `services/pipeline`'s folder name with no `moon.yml` required, though it has one for its tasks). Toolchains: `node: 24.14.0` + `pnpm: 9.15.0`, both pinned, no Python toolchain (per the Evidence section above — `unstable_uv`/`unstable_python` remain experimental). `.moon/tasks/node.yml` is scoped with `inheritedBy: { toolchains: ['node'] }` so it only reaches projects with a `package.json`; `services/pipeline/moon.yml` defines plain `uv run ...` command tasks directly, as decided.

**Codegen graph edge**: `core:gen-contracts` (in `packages/core/moon.yml`) wraps the existing `scripts/gen-contracts.sh`, with `outputs: ['generated/**', '/services/pipeline/app/models/generated.py']` — the second entry is a workspace-relative path (leading `/`), moon's syntax for a task output outside the task's own project. `services/pipeline/moon.yml`'s `typecheck`/`test` tasks declare `deps: ['core:gen-contracts']`. The drift gate (`moon run core:gen-contracts && git diff --exit-code -- packages/core/generated services/pipeline/app/models/generated.py`) is AT-0014-5, verified by mutating a zod enum in `packages/core/src/schemas/rating.ts` without committing the regenerated output and confirming the gate fails, then reverting (see `scripts/at/at-0014.sh`).

**Build-order finding (empirical, not in the moon docs as written)**: a `"workspace:*"` dependency in `package.json` is enough for moon's affected-detection to cascade (confirmed: touching `packages/core/src` correctly affects `db`, `api`, `web`, `site`, `pipeline` per AT-0014-2), but it is **not** enough for the `^:build` task dependency (used by the shared `typecheck`/`test`/`build` tasks, mirroring turbo.json's old `dependsOn: ["^build", "build"]`) to actually order a dependent project's build after its dependency's. Without an explicit `dependsOn:` in a project's `moon.yml`, `moon run db:build` races `core:build` and fails or succeeds depending on scheduling luck — reproduced locally and inside the Docker build. Fixed by adding `dependsOn: [core]` / `dependsOn: [core, db]` to every project with a `workspace:*` dependency (`packages/db`, `apps/web`, `apps/site`, `services/api`). This also turned out to be the mechanism `moon docker scaffold <project>` uses to decide which other projects' *sources* (not just manifests) to copy into the Docker build — see below.

**Dockerfiles** (`services/api/Dockerfile`): rewritten around `moon docker scaffold api` (derives the file list from the project graph via the `dependsOn` above, replacing the interim `pnpm fetch` approach and its implicit hard-coded package list) and `moon run api:build` (derives build order). Three deviations from the ADR's plan, each verified empirically and documented inline in the Dockerfile:
1. `MOON_TOOLCHAIN_FORCE_GLOBALS=1` (to reuse the dhi.io image's own corepack-pinned Node/pnpm instead of a redundant download) breaks `moon docker setup`'s dependency-install action entirely — confirmed via `MOON_LOG=debug`, the action graph never includes an install step ("Tasks: 0 tasks ran"). Not used; moon manages its own pinned Node/pnpm toolchain inside the image instead.
2. `moon docker setup` does not run a dependency-install action even *without* force-globals, in this moon version, against this pnpm workspace — also "Tasks: 0 tasks ran". `pnpm install --frozen-lockfile` is run explicitly instead, against the full workspace manifest/lockfile set `moon docker scaffold` already assembled.
3. `moon docker prune` does not shrink a pnpm-hoisted install — verified: root `node_modules` stayed ~1GB after prune (it deletes *per-project* `node_modules`, which pnpm only ever symlinks through; the real package content lives in the hoisted root store, which prune doesn't touch). `pnpm --filter @fact-checker-ke/api deploy --prod /repo/out` is used instead for the size-optimized runtime artifact — this is not a reintroduced hand-maintained dependency list, `deploy` resolves `@fact-checker-ke/api`'s own `workspace:*` dependencies the same way `pnpm install` does; it only names the one deployable, not its transitive graph.

Final `fact-checker-ke/api` image: 229MB (vs. 206MB pre-ADR-0014), non-root (uid 1000), no shell in the runtime stage, healthz verified (`{"status":"ok"}`, HTTP 200) with `NODE_ENV=development PORT=8080`.

`services/pipeline/Dockerfile` is **unchanged** — not a drive-by exception, a deliberate one per this ADR's own instruction to document rather than force a bad fit: the pipeline has no `package.json`/Node toolchain, and (unlike `services/api`) no live workspace dependency to resolve at Docker-build time — it only consumes a generated `.py` file that's already committed in its own tree via the drift-gated codegen chain, not a package.json-level dependency. `moon docker scaffold pipeline` *does* run (it pulls in `packages/core`'s TypeScript source too, because of the `core:gen-contracts` task dependency), but moon's docker integration adds no real value for a project with no Node toolchain to provision and no node_modules to prune. Image builds and passes healthz (`{"status":"ok"}`, HTTP 200) unchanged.

**CI** (`.github/workflows/ci.yml`): the `node` and `pipeline` jobs were merged into one `moon-ci` job running `moon ci` (affected-only; `fetch-depth: 0` and `filter: blob:none` per moon's CI guide, since affected-detection needs full history), with an explicit `--base`/`--head` pair on `pull_request` events (moon auto-detects on a direct push to `main`). The Postgres service container, `contracts-drift`, and `docker-images` jobs are unchanged in shape (still separate jobs, same names, so they're ready to be wired up as required status checks once Actions billing is restored — see ADR-0013).

**Tech debt / known gaps surfaced, not hidden**:
- `pipeline:lint` (`uv run ruff check .`) is new to CI — it wasn't run before (CI only ran `mypy`+`pytest`). It found 2 pre-existing issues (`RUF100` unused `noqa`, `RUF023` unsorted `__slots__`); both fixed with `ruff check --fix` as part of this change (trivial, safe, not behavioral).
- `services/api/src/repositories/postgres.ts` briefly appeared to fail strict typecheck during verification (Drizzle pgEnum columns typed as `string` instead of a literal union) — this is the exact "a zod v4 type change broke Drizzle pgEnum's" incident ADR-0013 names as prior art. It was NOT reproducible on a clean, forced `moon ci` run or `moon run api:typecheck --force` (confirmed GREEN both ways); the one failing run is attributed to a stale `packages/db/dist` from an earlier manual build step during this same debugging session, not a real defect. No code changes were made for it. Flagged here in case it recurs.

## Integrator re-verification (2026-10-03)

Wave-1's GREEN report did not survive independent re-runs; three findings, all fixed in `fix(tooling): make AT-0014 suite idempotent and env-complete`:
1. **AT-0014-1 was cache-masked.** `moon ci` without `VITE_API_URL` fails on a cold cache (site's production guard). The env was present in CI but missing from the AT script and the pre-push hook; both now export dev placeholders.
2. **AT-0014-4 was not idempotent.** moon's cache persists across invocations, so the fixed probe URL reported a bogus HIT on the script's second run; probes are now unique per run. ADR-0019's "run the suite twice" rule exists precisely for this class.
3. **Concurrent moon invocations corrupted `.moon/cache/states/workspaceGraph.json`** (json::parse_file, missing field `projects`), producing misleading downstream errors. Remedy: `rm -rf .moon/cache` (gitignored, safe). Operational rule: never run two moon instances against one workspace concurrently; AT suites must own the workspace exclusively while running.

Final state: AT-0014 and AT-0013 suites GREEN on two consecutive exclusive runs each.
