# Getting Started

This guide covers local development. The product baseline is documented in [MVP Scope](mvp-scope.md); deployment and data handling procedures are in the [Operations Guide](operations.md).

## Requirements

- Node.js 26.10.0
- pnpm 12.6.0
- Docker Compose v2 for the full local stack
- Rust 1.98.1 and Cargo only for Rust development and tests

Install workspace dependencies from the repository root:

```bash
pnpm install
```

## Run the playground

Run the Next.js playground directly:

```bash
pnpm dev
```

Choose another supported router with `pnpm dev --router react` or `pnpm dev --router tanstack`. The playground is available at `http://localhost:3000` (React Router: `3101`; TanStack Router: `3102`).

## Run the full local stack

Copy `.env.example` to `.env`, then start PostgreSQL, migrations, backend services, Dashboard and playground:

```bash
cp .env.example .env
pnpm dev:up
```

The Dashboard is at `http://localhost:13000/dashboard`; the Next.js playground is at `http://localhost:3000`. The default startup leaves the Site Registry empty. To create the local demo Site, configure a non-empty `LOCAL_DEV_INGEST_KEY` in `.env` and explicitly run:

```bash
pnpm dev:up --seed-init
```

The seed is for local development only. It does not overwrite existing Site configuration or create analytics events. Open the Dashboard and use **Add a Site** to exercise the normal onboarding flow instead.

Stop the stack while keeping its database volume:

```bash
pnpm dev:down
```

## Checks and tests

```bash
pnpm check
pnpm test
pnpm format:check
pnpm format:check:docs
pnpm build
```

PostgreSQL migration and integration tests require an isolated test database; see [Operations Guide](operations.md#database-migrations-and-tests). The E2E runner installs Chromium separately when needed:

```bash
pnpm playwright:install
pnpm e2e --all
```

Run one suite with its package shortcut, such as `pnpm e2e:dashboard` or `pnpm e2e:site-onboarding`. `pnpm e2e:down` stops a separately retained E2E environment. E2E databases are isolated from the development Compose database.

## Country Geo data

The backend requires an operator-supplied MMDB at the configured `GEOIP_DATABASE_PATH`; Compose does not download it. Supported data sources, licensing, update and rollback procedures are in [Country Geo data operations](operations.md#country-geo-database).
