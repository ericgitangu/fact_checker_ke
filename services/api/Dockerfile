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
# Build context = repo root (not services/api) because this build needs the
# pnpm workspace: pnpm-workspace.yaml, the root lockfile, and the
# @fact-checker-ke/core workspace package that @fact-checker-ke/api depends
# on. See root .dockerignore for what's excluded from that context.

FROM dhi.io/node:24-debian12-dev@sha256:57962dc15604fdff694d47b7665fdd6515429fd35dfc90a16cd7cfdbe1d6d41c AS base
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
# Dependency-graph agnostic: `pnpm fetch` needs only the lockfile, so this
# layer is cached until dependencies change and never lists workspace
# packages by hand (adding a package must not require editing this file).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN pnpm fetch --frozen-lockfile

FROM deps AS build
COPY packages packages
COPY services/api services/api
# `api...` = the API plus every workspace package it depends on, in
# topological order, resolved from package.json — not from this file.
RUN pnpm install --offline --frozen-lockfile --filter "@fact-checker-ke/api..." \
 && pnpm --filter "@fact-checker-ke/api..." build
# Self-contained, hard-linked, prod-only node_modules + dist for the
# runtime stage — no devDependencies, no workspace symlinks to resolve
# at runtime, nothing else from the monorepo.
RUN pnpm --filter @fact-checker-ke/api deploy --prod /repo/out

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
