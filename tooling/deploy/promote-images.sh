#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE_NAMESPACE:?}"
: "${IMAGE_TAG:?}"
: "${VERSION:?}"
: "${REVISION:?}"

images=(collector processor analytics-api db-tools dashboard)
stable_tags=("sha-${REVISION}" "v${VERSION}")
declare -A candidate_digests
declare -A existing_targets

digest() {
  docker buildx imagetools inspect --raw "$1" | sha256sum | cut -d' ' -f1
}

is_missing_manifest() {
  grep -Eiq '(^|[^[:alnum:]_])(404|not found|manifest unknown)([^[:alnum:]_]|$)' "$1"
}

# Check every release destination before changing any stable tag.
for image in "${images[@]}"; do
  candidate="ghcr.io/${IMAGE_NAMESPACE}/traceleaf-${image}:${IMAGE_TAG}"
  candidate_digests[$image]="$(digest "$candidate")"
  for tag in "${stable_tags[@]}"; do
    target="ghcr.io/${IMAGE_NAMESPACE}/traceleaf-${image}:${tag}"
    inspect_error="$(mktemp)"
    if docker buildx imagetools inspect "$target" >/dev/null 2>"$inspect_error"; then
      existing_digest="$(digest "$target")"
      if [[ "${candidate_digests[$image]}" != "$existing_digest" ]]; then
        rm -f "$inspect_error"
        echo "Refusing release: $target already points to a different manifest digest" >&2
        exit 1
      fi
      existing_targets[$target]=true
    elif is_missing_manifest "$inspect_error"; then
      echo "$target does not exist yet and can be promoted"
    else
      cat "$inspect_error" >&2
      rm -f "$inspect_error"
      echo "Cannot safely determine whether $target already exists" >&2
      exit 1
    fi
    rm -f "$inspect_error"
  done
done

# Only promote after all destinations have passed the preflight.
for image in "${images[@]}"; do
  candidate="ghcr.io/${IMAGE_NAMESPACE}/traceleaf-${image}:${IMAGE_TAG}"
  for tag in "${stable_tags[@]}"; do
    target="ghcr.io/${IMAGE_NAMESPACE}/traceleaf-${image}:${tag}"
    if [[ "${existing_targets[$target]:-false}" == true ]]; then
      echo "$target already points to candidate digest sha256:${candidate_digests[$image]}"
      continue
    fi
    docker buildx imagetools create --tag "$target" "$candidate"
    promoted_digest="$(digest "$target")"
    [[ "${candidate_digests[$image]}" == "$promoted_digest" ]] || {
      echo "Promotion digest mismatch for $target" >&2
      exit 1
    }
    echo "Promoted $target digest sha256:$promoted_digest"
  done
done
