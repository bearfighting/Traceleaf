# syntax=docker/dockerfile:1.7

FROM node:26.10.0-bookworm-slim AS dashboard-build

WORKDIR /workspace

RUN npm install --global pnpm@12.6.0

COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @web-analytics/dashboard build

FROM node:26.10.0-bookworm-slim AS dashboard-runtime

ENV NODE_ENV=production
WORKDIR /workspace/apps/dashboard

COPY --from=dashboard-build --chown=node:node /workspace/node_modules /workspace/node_modules
COPY --from=dashboard-build --chown=node:node /workspace/apps/dashboard/node_modules /workspace/apps/dashboard/node_modules
COPY --from=dashboard-build --chown=node:node /workspace/apps/dashboard/.next /workspace/apps/dashboard/.next
COPY --from=dashboard-build --chown=node:node /workspace/apps/dashboard/package.json ./package.json
COPY --from=dashboard-build --chown=node:node /workspace/apps/dashboard/next.config.ts ./next.config.ts

USER node
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
