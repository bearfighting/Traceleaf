#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run the Docker processing environment." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. Use the 'docker compose' command." >&2
  exit 1
fi

exec docker compose -f compose.yaml -f compose.backend.yaml -f compose.dev.yaml --profile backend --profile storage --profile processing --profile playground-next up --build --wait
