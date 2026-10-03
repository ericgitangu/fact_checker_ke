# syntax=docker/dockerfile:1.7
#
# Base images: Docker Hardened Images (dhi.io), Apache-2.0, free Community
# tier — confirmed via `docker login dhi.io` (reused existing Docker Hub
# session, no new credentials entered) and a live pull/run on 2026-10-03.
# https://docs.docker.com/dhi/ | https://www.docker.com/blog/docker-hardened-images-for-every-developer/
# Pinned by digest for reproducibility; `-dev` variant has a shell + npm/
# corepack for the build stage, the base (non-dev) runtime variant ships
# node only, no shell, no package manager — verified: `sh -c ...` fails with
# "executable file not found in $PATH" on dhi.io/node:24-debian12.
#
# ADR-0014 (2026-10-03): moon replaces the interim `pnpm fetch` approach.
# `moon docker scaffold` derives which workspace packages this image needs
# (via services/api/moon.yml's `dependsOn: [core, db]`) and `moon run
# api:build` derives build order from the same graph -- neither hard-codes
# the dependency list in this file, which is exactly what broke when
# packages/db landed (see ADR-0014's Problem section). Build context =
# repo root: the skeleton stage needs the WHOLE workspace to walk the
# graph (see root .dockerignore's ADR-0014 note).
#
# DEVIATIONS (verified empirically, 2026-10-03 -- moon 2.5.6):
# 1. MOON_TOOLCHAIN_FORCE_GLOBALS (to reuse the dhi.io image's own
#    corepack-pinned Node/pnpm instead of a second download) breaks
#    `moon docker setup`'s dependency-install action entirely -- confirmed
#    via MOON_LOG=debug: with globals forced, the action graph never
#    includes an install step ("Tasks: 0 tasks ran"). Not used here; moon
#    manages Node/pnpm itself, pinned to the same versions as
#    .moon/toolchains.yml (24.14.0 / 9.15.0).
# 2. `moon docker setup` ALSO doesn't run a dependency-install action even
#    WITHOUT force-globals (same "0 tasks ran" result) -- this looks like a
#    real gap/version drift from the docs guide's description, not a
#    config mistake. `pnpm install --frozen-lockfile` is run explicitly
#    instead, against the full workspace lockfile scaffold assembled.
# 3. `moon docker prune` does not shrink a pnpm-hoisted install -- verified:
#    root node_modules stayed ~1GB after `moon docker prune` (it deletes
#    per-project node_modules, which pnpm only ever symlinks into; the
#    real content lives in the hoisted root store, which prune doesn't
#    touch). `pnpm --filter @fact-checker-ke/api deploy --prod` is used
#    instead for the size-optimized runtime artifact (40MB, matching the
#    pre-ADR-0014 image) -- this isn't a hand-maintained dependency list,
#    `deploy` resolves @fact-checker-ke/api's own workspace:* dependencies
#    the same way `pnpm install` already does.
# All three are tracked in docs/adr/0014-monorepo-tooling-moon.md's
# Implementation notes for re-evaluation against a later moon release.

FROM dhi.io/node:24-debian12-dev@sha256:57962dc15604fdff694d47b7665fdd6515429fd35dfc90a16cd7cfdbe1d6d41c AS base
WORKDIR /repo
RUN corepack enable
# The dhi.io image symlinks node/npm into /usr/local/bin from npm's real
# global prefix (/opt/nodejs/node-v<ver>/bin -- not on PATH itself), but a
# package installed *after* the image was built doesn't get that symlink
# automatically; create it explicitly so `moon` resolves.
RUN npm install -g @moonrepo/cli@2.5.6 \
 && ln -s "$(npm prefix -g)/bin/moon" /usr/local/bin/moon

FROM base AS skeleton
# Full repo -- moon scaffolds only what services/api actually depends on
# (derived from the project graph via moon.yml's dependsOn, not this file).
COPY . .
RUN moon docker scaffold api

FROM base AS build
# "configs" phase: manifests/lockfiles only (cacheable until deps change) --
# every workspace member's package.json, because pnpm needs the full
# workspace shape to validate pnpm-lock.yaml, even though only api's
# closure gets source files in the next phase.
COPY --from=skeleton /repo/.moon/docker/configs .
RUN moon docker setup
# See DEVIATION 2 above: moon docker setup doesn't install dependencies in
# this version, so do it directly.
RUN pnpm install --frozen-lockfile
# "sources" phase: source files for api + its dependencies only.
COPY --from=skeleton /repo/.moon/docker/sources .
RUN moon run api:build
# See DEVIATION 3 above: moon docker prune doesn't shrink a pnpm-hoisted
# install, so produce the size-optimized runtime artifact with pnpm's own
# deploy command instead.
RUN pnpm --config.confirmModulesPurge=false --filter @fact-checker-ke/api deploy --prod /repo/out

# Runtime: dhi.io/node non-dev — no shell, no package manager, default
# non-root user (uid 1000), only the node binary + what we copy in.
FROM dhi.io/node:24-debian12@sha256:dea789bc31dc6c4e743ad29d72582e2092aac8e068e0714ffbc1625bd463efff AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=1000:1000 /repo/out/dist ./dist
COPY --from=build --chown=1000:1000 /repo/out/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /repo/out/package.json ./package.json
USER 1000
# Cloud Run injects PORT (default 8080 locally); server.ts reads
# process.env.PORT itself, so no shell/entrypoint indirection is needed.
EXPOSE 8080
CMD ["node", "dist/server.js"]
