# syntax=docker/dockerfile:1.7

FROM node:26.10.0-bookworm-slim AS dashboard-build

WORKDIR /workspace

RUN npm install --global pnpm@12.6.0

COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @web-analytics/dashboard build \
  && mkdir -p /workspace/apps/dashboard/public

FROM node:26.10.0-bookworm-slim AS dashboard-runtime

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /workspace

COPY --from=dashboard-build --chown=node:node /workspace/apps/dashboard/.next/standalone ./
COPY --from=dashboard-build --chown=node:node /workspace/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=dashboard-build --chown=node:node /workspace/apps/dashboard/public ./apps/dashboard/public

USER node
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
