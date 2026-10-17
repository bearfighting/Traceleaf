# Raspberry Pi LAN Deployment

This deployment profile runs the production Rust binaries and a production Next.js Dashboard on a Raspberry Pi. It is intended for LAN validation and a small single-host installation. It does not configure Cloudflare Tunnel; add Tunnel routing later for the Collector only.

## Requirements

- Raspberry Pi OS or Debian on a 64-bit ARM system, with Docker Engine and the Compose plugin.
- A stable LAN IPv4 address for the Pi. Configure a DHCP reservation on the router, then use that address for `DEPLOYMENT_HOST_IP`.
- An SSD-backed Docker data directory is recommended for PostgreSQL. The Compose volume `postgres_data_v18` stores the database.
- A supported country lookup MMDB at `./data/GeoLite2-Country.mmdb`. Collector requires this external file to start. Obtain it under the provider's terms; Compose does not download it. See [Country Geo data operations](operations.md#country-geo-database).
- GHCR read access for the private Traceleaf image packages. Log in with a read-only token and Docker credential helper before pulling images; see [Linux deployment](deployment-linux.md#ghcr-credentials).
- Node.js and pnpm are optional and only needed for the repository's `pnpm deploy:*` shortcuts. Direct Docker Compose commands work without them.

## Configure

In the deployment directory, copy the supplied environment template and edit it:

```bash
cp .env.deploy.example .env.deploy
```

Set `DEPLOYMENT_HOST_IP` to the Pi's reserved LAN address, `TRACELEAF_COMPOSE_PROJECT_NAME` to a stable Compose project name (the template uses `traceleaf` for new deployments), `TRACELEAF_IMAGE_NAMESPACE` to the lowercase GitHub owner, and `TRACELEAF_IMAGE_TAG` to an accepted release such as `v1.0.1`. Keep the Compose project name unchanged across upgrades so Compose reuses the existing containers and PostgreSQL volume. For an existing deployment, set it to that deployment's current Compose project name. Generate a PostgreSQL password containing only URL-safe characters; it is interpolated into the internal database URL. For example:

```bash
openssl rand -hex 24
```

Generate one deployment-admin token from 32 random bytes, encode it as unpadded Base64URL, and put the same value in `CONFIG_ADMIN_TOKENS` and `DASHBOARD_CONFIG_ADMIN_TOKEN`:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

`CONFIG_ADMIN_TOKENS` is a JSON array containing that token, for example `["generated-token"]`. Keep `.env.deploy` private; it is ignored by Git. Do not use the development sample credentials from `.env.example`.

Place the MMDB file at the configured path and create the data directory if needed:

```bash
mkdir -p data
```

## Start and access on the LAN

Pull the accepted ARM64 image manifest and start the stack:

```bash
pnpm deploy:up
pnpm deploy:ps
pnpm deploy:logs
```

Compose pulls the prebuilt multi-architecture images; the Pi does not need the repository, Node.js, pnpm, Rust, or a build toolchain. The file publishes only Collector `4001` and Dashboard `13000`, bound to `DEPLOYMENT_HOST_IP`. Analytics API `4002` and PostgreSQL `5432` have no host port mapping and are available only on the Compose network.

- Dashboard: `http://<DEPLOYMENT_HOST_IP>:13000/dashboard`
- Collector health: `http://<DEPLOYMENT_HOST_IP>:4001/health`
- Collector event endpoint: `http://<DEPLOYMENT_HOST_IP>:4001/v1/events`

Do not configure router port forwarding for these ports. The host firewall should allow `13000` only from the home LAN. Collector can be LAN-reachable during SDK integration checks; later, when using Cloudflare Tunnel, remove its host port mapping and route the public Collector hostname to the container's port `4001` from a `cloudflared` container on the same Docker network. Keep Dashboard, Analytics API and PostgreSQL off the public Tunnel.

Create a Site in Dashboard settings and configure its allowed Origin to exactly match the website's origin (scheme, hostname and port). Create an Ingest Key there and configure the browser SDK with the LAN Collector endpoint and key. For browser testing, the website and Collector should both use HTTP or both use HTTPS; browsers block insecure HTTP requests from an HTTPS page.

The development seed and Playground are not part of this deployment and must not be used to initialize production Sites.

## Operations

- `pnpm deploy:pull` downloads the selected release images.
- `pnpm deploy:up` pulls images and starts/recreates services in the background. The migration job runs before dependent services start.
- On a deployment host without the repository or pnpm, run `docker compose --env-file .env.deploy --file compose.deploy.yaml pull`, then the same command with `up -d`. The Compose project name is required in `.env.deploy`; the template sets it to `traceleaf` for new deployments.
- `pnpm deploy:ps` shows service health and state.
- `pnpm deploy:logs` follows service logs; use `Ctrl-C` to stop following logs.
- `pnpm deploy:down` stops containers but preserves `postgres_data_v18`.

Before every upgrade, back up PostgreSQL and verify the backup. Review [Linux deployment](deployment-linux.md) for private GHCR login, release rollback, and migration compatibility guidance. Switching `TRACELEAF_IMAGE_TAG` back to an earlier version rolls back application images only; it does not reverse schema migrations. The general backup and restore procedure is in [Operations](operations.md#postgresql-backup-and-restore). Store backups somewhere other than the Pi's database disk and periodically verify a restore. Never use `docker compose down -v` for routine shutdown; that removes the database volume.

The Pi deployment is a single-host setup without automatic off-device backups, high availability or alerting. Review logs and backup completion manually during LAN validation.
