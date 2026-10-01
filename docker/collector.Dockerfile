FROM rust:1.98.1-bookworm

WORKDIR /workspace

ENV CARGO_HOME=/usr/local/cargo

RUN apt-get update \
  && apt-get install --no-install-recommends --yes curl \
  && rm -rf /var/lib/apt/lists/*

# Cache the Rust registry and git dependencies in the image. Source code is
# mounted by Compose for development, so the target directory remains an
# incremental named volume at runtime.
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/configuration-runtime/Cargo.toml crates/configuration-runtime/Cargo.toml
COPY services/analytics-api/Cargo.toml services/analytics-api/Cargo.toml
COPY services/collector/Cargo.toml services/collector/Cargo.toml
COPY services/processor/Cargo.toml services/processor/Cargo.toml
COPY tools/db-migrator/Cargo.toml tools/db-migrator/Cargo.toml
COPY tools/site-registry-importer/Cargo.toml tools/site-registry-importer/Cargo.toml
RUN mkdir -p crates/configuration-runtime/src services/analytics-api/src services/collector/src services/processor/src tools/db-migrator/src tools/site-registry-importer/src \
  && printf '#![allow(dead_code)]\n' > crates/configuration-runtime/src/lib.rs \
  && printf 'fn main() {}\n' > services/analytics-api/src/main.rs \
  && printf 'fn main() {}\n' > services/collector/src/main.rs \
  && printf 'fn main() {}\n' > services/processor/src/main.rs \
  && printf 'fn main() {}\n' > tools/db-migrator/src/main.rs \
  && printf 'fn main() {}\n' > tools/site-registry-importer/src/main.rs \
  && cargo fetch --locked

EXPOSE 4001

HEALTHCHECK --interval=2s --timeout=2s --start-period=180s --retries=15 \
  CMD curl --fail --silent http://127.0.0.1:4001/health || exit 1

CMD ["cargo", "run", "-p", "collector", "--", "serve", "--host", "0.0.0.0", "--port", "4001"]
