FROM node:26.10.0-bookworm-slim

WORKDIR /workspace

RUN apt-get update \
  && apt-get install --no-install-recommends --yes postgresql-client \
  && rm -rf /var/lib/apt/lists/*

COPY protocol/capabilities/capabilities.json protocol/capabilities/capabilities.json
COPY tooling/contracts/capability-seed.mjs tooling/contracts/capability-seed.mjs
COPY db/seeds/development/dev-seed.mjs db/seeds/development/dev-seed.mjs

CMD ["node", "db/seeds/development/dev-seed.mjs"]
