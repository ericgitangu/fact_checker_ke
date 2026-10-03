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
| ID | Behaviour |
|---|---|
| AT-0014-1 | `moon ci` on a clean tree runs lint, typecheck, test and build for every project, and passes |
| AT-0014-2 | Touching `packages/core/src` makes `moon query projects --affected` include core, db, api, web, site and pipeline |
| AT-0014-3 | Adding a new workspace package used by the API requires **no Dockerfile edit**, and the image still builds |
| AT-0014-4 | Changing `VITE_API_URL` invalidates the `site:build` cache |
| AT-0014-5 | The drift gate fails when a zod enum changes without regenerating |
