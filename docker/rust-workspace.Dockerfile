# syntax=docker/dockerfile:1.7

FROM rust:1.98.1-bookworm AS rust-dependencies

WORKDIR /workspace
ENV CARGO_HOME=/usr/local/cargo

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

FROM rust-dependencies AS rust-development

RUN apt-get update \
  && apt-get install --no-install-recommends --yes curl \
  && rm -rf /var/lib/apt/lists/*

FROM rust-development AS collector-dev
EXPOSE 4001
HEALTHCHECK --interval=2s --timeout=2s --start-period=180s --retries=15 \
  CMD curl --fail --silent http://127.0.0.1:4001/health || exit 1
CMD ["cargo", "run", "-p", "collector", "--", "serve", "--host", "0.0.0.0", "--port", "4001"]

FROM rust-development AS processor-dev
CMD ["cargo", "run", "-p", "processor", "--", "--poll-interval-ms", "1000"]

FROM rust-development AS analytics-api-dev
EXPOSE 4002
HEALTHCHECK --interval=2s --timeout=2s --start-period=180s --retries=15 \
  CMD curl --fail --silent http://127.0.0.1:4002/health || exit 1
CMD ["cargo", "run", "-p", "analytics-api", "--", "--host", "0.0.0.0", "--port", "4002"]

FROM rust-dependencies AS rust-release-builder
COPY . .
RUN --mount=type=cache,id=web-analytics-rust-release-target,target=/workspace/target,sharing=locked \
  cargo build --locked --release --workspace \
  && mkdir -p /release \
  && cp target/release/collector target/release/processor target/release/analytics-api target/release/db-migrator /release/

FROM debian:bookworm-slim AS rust-runtime
RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

FROM rust-runtime AS collector-release
COPY --from=rust-release-builder /release/collector /usr/local/bin/collector
EXPOSE 4001
HEALTHCHECK --interval=2s --timeout=2s --start-period=30s --retries=15 \
  CMD curl --fail --silent http://127.0.0.1:4001/health || exit 1
ENTRYPOINT ["/usr/local/bin/collector"]
CMD ["serve", "--host", "0.0.0.0", "--port", "4001"]

FROM rust-runtime AS processor-release
COPY --from=rust-release-builder /release/processor /usr/local/bin/processor
ENTRYPOINT ["/usr/local/bin/processor"]
CMD ["--poll-interval-ms", "1000"]

FROM rust-runtime AS analytics-api-release
COPY --from=rust-release-builder /release/analytics-api /usr/local/bin/analytics-api
EXPOSE 4002
HEALTHCHECK --interval=2s --timeout=2s --start-period=30s --retries=15 \
  CMD curl --fail --silent http://127.0.0.1:4002/health || exit 1
ENTRYPOINT ["/usr/local/bin/analytics-api"]
CMD ["--host", "0.0.0.0", "--port", "4002"]

FROM rust-runtime AS db-migrator-release
COPY --from=rust-release-builder /release/db-migrator /usr/local/bin/db-migrator
ENTRYPOINT ["/usr/local/bin/db-migrator"]
