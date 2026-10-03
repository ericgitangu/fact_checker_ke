# syntax=docker/dockerfile:1
# Multi-stage, non-root, arm64/amd64-friendly (no platform-specific base pin).

FROM node:24-slim AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/package.json
COPY services/api/package.json services/api/package.json
RUN pnpm install --frozen-lockfile --filter @fact-checker-ke/api... || pnpm install --filter @fact-checker-ke/api...

FROM deps AS build
COPY packages/core packages/core
COPY services/api services/api
RUN pnpm --filter @fact-checker-ke/core build && pnpm --filter @fact-checker-ke/api build

FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 fastify
COPY --from=build /repo/packages/core/dist /repo/packages/core/dist
COPY --from=build /repo/packages/core/package.json /repo/packages/core/package.json
COPY --from=build /repo/services/api/dist /repo/services/api/dist
COPY --from=build /repo/services/api/package.json /repo/services/api/package.json
COPY --from=build /repo/services/api/node_modules /repo/services/api/node_modules
WORKDIR /repo/services/api
USER fastify
EXPOSE 8080
CMD ["node", "dist/server.js"]
