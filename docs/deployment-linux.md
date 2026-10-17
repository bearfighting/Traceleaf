# Linux x86-64 Deployment

This guide deploys the accepted linux/amd64 platform images on a 64-bit Linux host. Raspberry Pi operators can use the same Compose commands with the Pi specific settings in [Raspberry Pi deployment](deployment-raspberry-pi.md).

## Requirements and files

- Docker Engine with the Compose plugin, on 64-bit Linux.
- compose.deploy.yaml and .env.deploy.example; create .env.deploy from the template.
- A supported country MMDB at ./data/GeoLite2-Country.mmdb; keep it outside the images.
- Read access to the private GHCR packages.

The host does not need a repository checkout, Node.js, pnpm, Rust, or a compiler. Copy the Compose file and environment template to a deployment directory, create .env.deploy there, and place the external data/ folder beside the Compose file. Docker keeps the PostgreSQL volume separate from the application images.

## GHCR credentials

Create a credential with read:packages only. Authenticate interactively so the token is not added to shell history, and use a configured Docker credential store or helper:

```sh
read -rsp "GHCR read token: " GHCR_READ_TOKEN
printf '\n'
printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io --username YOUR_GITHUB_USER --password-stdin
unset GHCR_READ_TOKEN
```

Do not put the token in .env.deploy, Compose files, shell scripts, or images. Confirm Docker reports a credential helper in its configuration before using a persistent host.

## Configure and start

Copy .env.deploy.example to .env.deploy. Set:

- TRACELEAF_IMAGE_NAMESPACE to the lowercase GitHub owner.
- TRACELEAF_IMAGE_TAG to an accepted platform release such as v1.0.1.
- TRACELEAF_COMPOSE_PROJECT_NAME to a stable Compose project name. The template sets it to traceleaf for new deployments; existing installations must set their current project name so upgrades reuse the same PostgreSQL volume.
- DEPLOYMENT_HOST_IP to the trusted private interface address where Collector and Dashboard should listen.
- The PostgreSQL password and matching Dashboard / configuration admin tokens as described in the template.
- DASHBOARD_PORT if the host's selected port differs from 13000.

Prepare the external GeoIP database and protect access to .env.deploy. Restrict Dashboard access with the host firewall. PostgreSQL and Analytics API have no host port mapping.

```sh
docker compose --env-file .env.deploy --file compose.deploy.yaml pull
docker compose --env-file .env.deploy --file compose.deploy.yaml up -d
docker compose --env-file .env.deploy --file compose.deploy.yaml ps
```

Compose runs db-migrate before dependent services. Confirm it exited successfully and check service health and logs after startup.

## Upgrade, backup, and rollback

Before each upgrade, complete and verify a PostgreSQL backup using the [operations procedure](operations.md#postgresql-backup-and-restore). Change the shared TRACELEAF_IMAGE_TAG to the desired accepted release, then pull and start as above. Keep the version, commit, resolved image digests, migration result, and healthcheck results with the deployment record.

Application image rollback consists of selecting the previous accepted vX.Y.Z tag and repeating pull/up. This does not reverse database migrations. Releases must keep migrations compatible with the immediately preceding platform version. For schema changes that cannot meet this rule, use a staged expand/contract deployment or stop and restore the verified backup using the documented recovery procedure; do not treat an old image tag as a database rollback.
