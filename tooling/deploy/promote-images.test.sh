#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_directory="$(mktemp -d)"
trap 'rm -rf "$temp_directory"' EXIT
mkdir -p "$temp_directory/bin"
cat > "$temp_directory/bin/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
scenario="${PROMOTION_SCENARIO:?}"
created_file="${PROMOTION_CREATED_FILE:?}"
action="${3:?}"
case "$action" in
  inspect)
    if [[ "${4:-}" == --raw ]]; then
      reference="${5:?}"
      image="${reference#*traceleaf-}"
      image="${image%%:*}"
      if [[ "$scenario" == conflict && "$reference" == *traceleaf-dashboard:v1.2.3 ]]; then
        printf '{"manifest":"conflicting-dashboard"}\n'
      else
        printf '{"manifest":"%s"}\n' "$image"
      fi
      exit 0
    fi
    reference="${4:?}"
    if [[ "$reference" == *:candidate-* ]]; then exit 0; fi
    if [[ "$scenario" == transient ]]; then
      echo 'ERROR: registry request failed: connection reset' >&2
      exit 1
    fi
    if [[ "$scenario" == absent ]] && ! grep -Fxq "$reference" "$created_file"; then
      echo "ERROR: $reference: not found" >&2
      exit 1
    fi
    exit 0
    ;;
  create)
    [[ "${4:?}" == --tag ]]
    printf '%s\n' "${5:?}" >> "$created_file"
    ;;
  *)
    echo "Unexpected mock Docker command: $*" >&2
    exit 2
    ;;
esac
MOCK_DOCKER
chmod +x "$temp_directory/bin/docker"

run_promotion() {
  local scenario="$1"
  : > "$temp_directory/created-$scenario"
  env PATH="$temp_directory/bin:$PATH" \
    PROMOTION_SCENARIO="$scenario" \
    PROMOTION_CREATED_FILE="$temp_directory/created-$scenario" \
    IMAGE_NAMESPACE=example-owner \
    IMAGE_TAG=candidate-test-run \
    VERSION=1.2.3 \
    REVISION=abcdef1234567890 \
    bash "$repo_root/tooling/deploy/promote-images.sh"
}

run_promotion absent >/dev/null
[[ "$(wc -l < "$temp_directory/created-absent")" -eq 10 ]]

run_promotion idempotent >/dev/null
[[ ! -s "$temp_directory/created-idempotent" ]]

if run_promotion conflict >/dev/null 2>&1; then
  echo 'Promotion unexpectedly accepted a conflicting stable digest' >&2
  exit 1
fi
[[ ! -s "$temp_directory/created-conflict" ]]

if run_promotion transient >/dev/null 2>&1; then
  echo 'Promotion unexpectedly treated a registry error as a missing tag' >&2
  exit 1
fi
[[ ! -s "$temp_directory/created-transient" ]]

echo 'Promotion preflight passed missing, idempotent, conflict, and transient-error cases.'
