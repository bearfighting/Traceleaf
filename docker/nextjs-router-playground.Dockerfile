FROM node:26.10.0-bookworm-slim

WORKDIR /workspace

RUN npm install --global pnpm@12.6.0

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/protocol-ts/package.json packages/protocol-ts/package.json
COPY packages/observer-core/package.json packages/observer-core/package.json
COPY packages/playground-support/package.json packages/playground-support/package.json
COPY packages/analytics-core/package.json packages/analytics-core/package.json
COPY packages/analytics-browser/package.json packages/analytics-browser/package.json
COPY packages/transport/package.json packages/transport/package.json
COPY examples/nextjs-router-playground/package.json examples/nextjs-router-playground/package.json

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY examples/nextjs-router-playground ./examples/nextjs-router-playground

ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV CI=true

EXPOSE 3000

CMD ["sh", "-c", "pnpm install --frozen-lockfile && pnpm build:packages && exec pnpm --filter @web-analytics/nextjs-router-playground dev --hostname 0.0.0.0"]
