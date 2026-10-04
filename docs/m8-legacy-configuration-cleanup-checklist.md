# M8 Legacy Configuration Cleanup Checklist

- Status: Not started
- Prerequisites: M6 explicit empty/seeded startup and Site onboarding complete; M7c Settings complete
- Scope: Remove Playground client configuration as an implicit input to platform database initialization
- Design references: [Platform Improvement Roadmap](platform-improvement-roadmap.md), [M6 Site Onboarding Checklist](m6-site-onboarding-checklist.md), [Site Onboarding and Settings Design](site-onboarding-settings-design.md), [ADR-014 Runtime Configuration Authority](decisions/ADR-014-runtime-configuration-authority.md)

## Goal

Keep the observed Playground's Browser SDK configuration separate from configuration used to initialize platform-owned database records. Local development must retain its empty-by-default startup and explicit, repeatable seed workflow. A developer who chooses to send Playground events must connect the SDK to a Site and Ingest Key that are valid in the Site Registry, without making `NEXT_PUBLIC_*` values an implicit source for database writes.

M8 is local configuration cleanup. It does not change Site Management or Analytics API contracts, Site or Ingest Key semantics, event protocol, report meaning, or historical data.

## Current inventory

- `scripts/dev-seed.mjs` creates the fixed `site_example` Registry entry, default capabilities, and a `development` policy containing an Ingest Key digest.
- `compose.dev.yaml` supplies `DEV_SEED_INGEST_KEY` to `dev-seed` from `NEXT_PUBLIC_ANALYTICS_INGEST_KEY`. The same overlay assigns `site_example` to the Next.js, React Router, and TanStack Router Playground SDK configurations.
- `compose.yaml` exposes the Playground SDK's `NEXT_PUBLIC_ANALYTICS_SITE_ID` and `NEXT_PUBLIC_ANALYTICS_INGEST_KEY` settings, with `site_playground` as the base Site ID fallback. These are client integration settings and may remain available for explicit Playground setup.
- `.env.example` currently documents the sample Browser SDK settings and `PLAYGROUND_ORIGINS`.
- `pnpm dev:up` and the backend/processing development entry points run seed only with `--seed-init` (or its `--seed` shorthand). Ordinary startup is empty by default.
- `site_playground` also appears in Analytics test fixtures and historical definition import records. Those references are not local development seed wiring and must not be mechanically renamed or deleted.

## Boundaries

- Keep ordinary `pnpm dev:up` and other default startup commands free of Site creation or seed execution.
- Keep the explicit local seed idempotent and non-destructive. It must not overwrite manually managed capabilities, policy, Origins, or keys, and must not emit analytics events.
- Do not let the platform DB seed read `NEXT_PUBLIC_ANALYTICS_SITE_ID` or `NEXT_PUBLIC_ANALYTICS_INGEST_KEY` as implicit database initialization inputs.
- Keep Playground SDK values explicitly identifiable as browser integration configuration. Do not put admin credentials or server-only secrets in `NEXT_PUBLIC_*` variables.
- Preserve `--seed-init` / `--seed` behavior unless an implementation decision is documented before changing the interface.
- Keep `site_playground` historical fixtures, reports, and imported definitions intact; distinguish test/legacy data from active local seed configuration.
- Do not add synthetic analytics data generation to this work. `--seed-analysis` remains a separate future task.
- Do not change Docker services or volumes as part of planning; any implementation must preserve the existing volume lifecycle and isolated CI/E2E behavior.

## Delivery slices

### M8.1 — Freeze the seed and Playground configuration contract

- [ ] Decide how the explicit local seed receives the Site identity and Ingest Key material without reading Playground `NEXT_PUBLIC_*` variables.
- [ ] Decide how a developer explicitly configures the Playground SDK to send to the seeded Site, including how the local key is made available to the browser app.
- [ ] Document whether the seed and Playground share an explicitly supplied local credential or use separate provisioning steps; make the relationship understandable without coupling the seed implementation to SDK environment variable names.
- [ ] Confirm defaults: ordinary startup creates no Site; explicit seeding remains opt-in; local sample credentials are clearly development-only.
- [ ] Record any change to the existing fixed `site_example` or `--seed-init` contract in an ADR or this checklist before implementation.

**Exit:** The platform seed input and observed-client SDK configuration have distinct, documented ownership and invocation paths.

### M8.2 — Remove implicit Playground inputs from platform initialization

- [ ] Update Compose and seed tooling so DB initialization does not consume Playground `NEXT_PUBLIC_ANALYTICS_SITE_ID` or `NEXT_PUBLIC_ANALYTICS_INGEST_KEY` values.
- [ ] Ensure the explicit seed remains repeatable, preserves manually edited configuration, and stores only the Ingest Key digest in the Site policy.
- [ ] Ensure the Playground can still be configured to send events to an explicitly chosen Site and environment using the documented Browser SDK setup.
- [ ] Keep default `pnpm dev:up`, `pnpm docker:backend`, `pnpm docker:processing`, and `pnpm docker:dev` startup behavior empty and non-seeding unless the documented explicit seed option is provided.
- [ ] Remove stale or misleading sample configuration and comments while retaining SDK configuration needed by the Playground.

**Exit:** Database seed behavior is independent of Playground client variable names, while the documented explicit seed and SDK integration both work.

### M8.3 — Protect local, CI, and E2E workflows

- [ ] Add or update unit tests for seed argument parsing, seed environment/input validation, generated Site/policy values, idempotency, and non-overwrite behavior as applicable to the chosen contract.
- [ ] Verify effective Compose configuration for default startup, explicit seed, and each supported Playground router; confirm no unintended Site/key source remains.
- [ ] Verify CI and isolated E2E Compose projects do not depend on local seed credentials or a pre-existing local Site.
- [ ] Verify local seed does not create raw events, derived analytics facts, or definition revisions.
- [ ] Verify `pnpm dev:down` continues to preserve the PostgreSQL volume and ordinary startup does not mutate an existing Registry.

**Exit:** Local default/seeded workflows and CI/E2E remain isolated, and data lifecycle behavior is unchanged.

### M8.4 — Documentation and closeout

- [ ] Update `.env.example`, Getting Started, Playground instructions, and Site Onboarding design to match the frozen configuration contract.
- [ ] Run targeted seed/Compose tests and the documented dev-startup E2E in an available environment.
- [ ] Run `pnpm test`, `pnpm check`, `pnpm build`, `pnpm format:check`, `pnpm format:check:docs`, and `git diff --check`; record actual results and existing warnings.
- [ ] Confirm no protocol, Analytics API, report, or historical-data behavior changed.
- [ ] Update this checklist and the M8 roadmap status with implementation and validation evidence.

**Exit:** Platform initialization no longer depends on Playground SDK environment variables, all supported local workflows are documented and verified, and no unrelated Site/history data was removed.

## Validation record

No M8 implementation or validation has been performed yet. The current inventory above is a source/documentation review and is not implementation acceptance evidence.
