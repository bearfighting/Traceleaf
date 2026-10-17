#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

README_FILES=()
while IFS= read -r file; do
  README_FILES+=("$file")
done < <(
  node -e 'const fs = require("node:fs"); for (const pair of JSON.parse(fs.readFileSync("tooling/docs/readme-pairs.json", "utf8"))) console.log(pair.join("\n"))'
)

pnpm exec prettier --check docs "${README_FILES[@]}"
node tooling/docs/check-docs.mjs
