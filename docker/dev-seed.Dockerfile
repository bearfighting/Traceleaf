FROM node:26.10.0-bookworm-slim

WORKDIR /workspace

RUN apt-get update \
  && apt-get install --no-install-recommends --yes postgresql-client \
  && rm -rf /var/lib/apt/lists/*

COPY protocol/capabilities/capabilities.json protocol/capabilities/capabilities.json
COPY scripts/capability-seed.mjs scripts/capability-seed.mjs
COPY scripts/dev-seed.mjs scripts/dev-seed.mjs

CMD ["node", "scripts/dev-seed.mjs"]
