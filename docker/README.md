# Docker Development

The repository provides development containers for the Next.js, React Router and TanStack Router playgrounds, Collector, Processor, Analytics API and Dashboard.

From the repository root:

```bash
pnpm docker:dev
```

The Playground is available at:

```text
http://localhost:3000
```

Select another playground with:

```bash
pnpm docker:dev --router react       # http://localhost:3101
pnpm docker:dev --router tanstack    # http://localhost:3102
pnpm docker:dev --router react --with-backend
```

The wrapper accepts only `next`, `react` and `tanstack`. `--with-backend`
enables the `backend`, `storage` and `processing` profiles in addition to the
selected playground profile. Ports can be overridden with
`PLAYGROUND_NEXT_PORT`, `PLAYGROUND_REACT_PORT` and
`PLAYGROUND_TANSTACK_PORT`.

The Playground uses `MockTransport` by default. For a standalone Playground or
the base Compose configuration, set these Browser SDK values in `.env`:

```env
NEXT_PUBLIC_ANALYTICS_TRANSPORT=fetch
NEXT_PUBLIC_ANALYTICS_ENDPOINT=http://localhost:4001/v1/events
NEXT_PUBLIC_ANALYTICS_INGEST_KEY=public-key-example
NEXT_PUBLIC_ANALYTICS_SITE_ID=site_example
```

Those `NEXT_PUBLIC_ANALYTICS_*` values configure the browser SDK only; they do
not create a Site or initialize database policy. The `pnpm docker:backend`
development entry point loads `compose.dev.yaml`, where the SDK key instead
comes from `LOCAL_DEV_INGEST_KEY` and the Playground targets the fixed
`site_example` Site. Set `LOCAL_DEV_INGEST_KEY` in `.env` and explicitly seed
that Site with:

```bash
pnpm docker:backend --seed-init
```

Ordinary startup does not seed. The same `LOCAL_DEV_INGEST_KEY` is mapped to
the seed and Playground SDK; a missing or blank key makes explicit seeding
fail. These sample values are for local development only.

For a manually configured Site, start the Collector with the backend profile:

```bash
docker compose --profile backend up --build collector
```

To start the Playground only after the Collector is healthy, use the backend
Compose override:

```bash
docker compose \
  -f compose.yaml \
  -f compose.backend.yaml \
  --profile backend up --build
```

The same workflow is available as:

```bash
pnpm docker:backend
```

The default `pnpm docker:dev` workflow does not load this override. It keeps
the Playground on MockTransport and does not require the Collector.

The standalone `db-migrate` service runs PostgreSQL migrations before the Collector, Processor, and Analytics API. The services consume the schema but do not migrate it during startup. The Collector is available at `http://localhost:4001` and exposes `GET /health`, `POST /v1/events`, and CORS preflight for `/v1/events`. POST requests require both an allowlisted `Origin` and the configured `X-Ingest-Key`; in the PostgreSQL-backed workflow accepted events are stored in `raw_events`. Each `site_id + Origin` is limited to 600 requests per minute.

Start the PostgreSQL-backed Collector, Processor and Analytics API workflow with:

```bash
pnpm docker:processing
```

The Analytics API is available at `http://localhost:4002`. It exposes `/health`, all-time site Overview, and date-range Reports endpoints. The API reads only the PostgreSQL aggregate tables.

Start the Dashboard together with the processing workflow:

```bash
docker compose \
  --profile backend \
  --profile storage \
  --profile processing \
  --profile dashboard \
  up --build --wait
```

The Dashboard is available at `http://localhost:13000/dashboard`. Its server-side query client uses `http://analytics-api:4002`; the Dashboard service has no PostgreSQL connection.

Run the complete Analytics workflow with an isolated E2E Compose project:

```bash
pnpm e2e:analytics
```

The E2E harness uses ports `14001`, `14002` and `15432`, and does not remove the existing PostgreSQL volume.

Run the complete Dashboard browser workflow (install Chromium once first):

```bash
pnpm playwright:install
pnpm e2e:dashboard
```

Generate a key without modifying the TOML configuration:

```bash
cargo run -p collector -- key generate --site site_example --environment production
```

Add the output to the matching `ingest_keys` entry and configure the Website Origin in `allowed_origins` before sending local events. CORS preflight returns `204`; rate-limited requests return `429` with `Retry-After: 60`.

The Compose setup mounts the source directory and keeps dependency/build directories in named volumes. The Collector image caches Cargo registry dependencies during image build and keeps `/workspace/target` in a named volume for incremental compilation. The Router playground image builds the workspace packages before starting the Playground, including the selected adapter facade, `analytics-browser`, transport, and shared playground support. Changes to Playground source hot reload; after changing package source, restart the container so the package can be rebuilt. PostgreSQL, BeaconTransport, retries, and durable storage are intentionally not part of this integration PR.
