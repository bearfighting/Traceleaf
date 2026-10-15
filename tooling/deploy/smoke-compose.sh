#!/usr/bin/env bash
set -euo pipefail
: "${TRACELEAF_IMAGE_NAMESPACE:?}"
: "${TRACELEAF_IMAGE_TAG:?}"
: "${DEPLOYMENT_HOST_IP:?}"
: "${SMOKE_PROJECT:?}"
: "${SMOKE_ARCHITECTURE:?}"
env_file="$(mktemp)"
override_file="$(mktemp --suffix=.yaml)"
geo_data_dir="$(mktemp -d)"
compose=(docker compose --project-name "$SMOKE_PROJECT" --env-file "$env_file" --file compose.deploy.yaml --file "$override_file")
cleanup() {
  if [[ "${smoke_passed:-false}" != true ]]; then "${compose[@]}" logs --no-color || true; fi
  "${compose[@]}" down --volumes --remove-orphans || true
  rm -f "$env_file" "$override_file"
  rm -rf "$geo_data_dir"
}
trap cleanup EXIT
cp tests/fixtures/geo/GeoLite2-Country-Test.mmdb "$geo_data_dir/GeoLite2-Country.mmdb"
cat > "$env_file" <<EOF
TRACELEAF_IMAGE_NAMESPACE=$TRACELEAF_IMAGE_NAMESPACE
TRACELEAF_IMAGE_TAG=$TRACELEAF_IMAGE_TAG
DEPLOYMENT_HOST_IP=$DEPLOYMENT_HOST_IP
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-smoke-url-safe-password}
CONFIG_ADMIN_TOKENS=${CONFIG_ADMIN_TOKENS:-["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]}
DASHBOARD_CONFIG_ADMIN_TOKEN=${DASHBOARD_CONFIG_ADMIN_TOKEN:-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA}
DASHBOARD_PORT=${DASHBOARD_PORT:-13000}
PROCESSOR_POLL_INTERVAL_MS=${PROCESSOR_POLL_INTERVAL_MS:-1000}
GEOIP_TRUSTED_PROXIES=${GEOIP_TRUSTED_PROXIES:-}
EOF
cat > "$override_file" <<EOF
services:
  collector:
    volumes:
      - ${geo_data_dir}:/workspace/data:ro
EOF
"${compose[@]}" pull
"${compose[@]}" up -d
expected_arch="$SMOKE_ARCHITECTURE"
for service in db-migrate db-audit-purger collector processor analytics-api dashboard; do
  image="$("${compose[@]}" config --format json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).services[process.argv[1]].image))' "$service")"
  actual_arch="$(docker image inspect "$image" --format '{{.Architecture}}')"
  [[ "$actual_arch" == "$expected_arch" ]] || { echo "$service resolved to $actual_arch, expected $expected_arch" >&2; exit 1; }
done
migration_id="$("${compose[@]}" ps -a -q db-migrate)"
for attempt in $(seq 1 90); do
  state="$(docker inspect "$migration_id" --format '{{.State.Status}}')"
  [[ "$state" == exited ]] && break
  [[ "$state" == running ]] || { echo "Migration container entered state $state" >&2; exit 1; }
  sleep 2
done
[[ "$(docker inspect "$migration_id" --format '{{.State.ExitCode}}')" == 0 ]] || { echo "db-migrate did not complete successfully" >&2; exit 1; }
for service in postgres collector analytics-api dashboard; do
  container_id="$("${compose[@]}" ps -q "$service")"
  for attempt in $(seq 1 90); do
    health="$(docker inspect "$container_id" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')"
    [[ "$health" == healthy ]] && break
    [[ "$health" != unhealthy ]] || { echo "$service healthcheck failed" >&2; exit 1; }
    sleep 2
  done
  [[ "$health" == healthy ]] || { echo "$service did not become healthy" >&2; exit 1; }
done
processor_id="$("${compose[@]}" ps -q processor)"
[[ "$(docker inspect "$processor_id" --format '{{.State.Status}}')" == running ]] || { echo "Processor is not running" >&2; exit 1; }
if docker logs "$processor_id" 2>&1 | grep -Eiq '(^|[[:space:]])(ERROR|FATAL)([[:space:]:]|$)'; then
  echo "Processor startup logs contain an error" >&2
  exit 1
fi
"${compose[@]}" run --rm --entrypoint /usr/local/bin/db-migrator db-audit-purger --purge-expired-configuration-audit
smoke_passed=true
echo "Deployment smoke passed on linux/$expected_arch"
