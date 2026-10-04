# M8 Legacy Configuration Cleanup Checklist

- Status: Complete (2026-10-04)
- Prerequisites: M6 explicit empty/seeded startup and Site onboarding complete; M7c Settings complete
- Scope: Remove Playground client configuration as an implicit input to platform database initialization
- Design references: [Platform Improvement Roadmap](platform-improvement-roadmap.md), [M6 Site Onboarding Checklist](m6-site-onboarding-checklist.md), [Site Onboarding and Settings Design](site-onboarding-settings-design.md), [ADR-014 Runtime Configuration Authority](decisions/ADR-014-runtime-configuration-authority.md)

## Goal

Keep the observed Playground's Browser SDK configuration separate from configuration used to initialize platform-owned database records. Local development must retain its empty-by-default startup and explicit, repeatable seed workflow. A developer who chooses to send Playground events must connect the SDK to a Site and Ingest Key that are valid in the Site Registry, without making `NEXT_PUBLIC_*` values an implicit source for database writes.

M8 is local configuration cleanup. It does not change Site Management or Analytics API contracts, Site or Ingest Key semantics, event protocol, report meaning, or historical data.

## Current inventory

- `scripts/dev-seed.mjs` creates the fixed `site_example` Registry entry, default capabilities, and a `development` policy containing an Ingest Key digest.
- `compose.dev.yaml` supplies `DEV_SEED_INGEST_KEY` to `dev-seed` and `NEXT_PUBLIC_ANALYTICS_INGEST_KEY` to the Next.js, React Router, and TanStack Router Playground SDK configurations, all from `LOCAL_DEV_INGEST_KEY`. The overlay assigns `site_example` to each Playground.
- `compose.yaml` exposes the Playground SDK's `NEXT_PUBLIC_ANALYTICS_SITE_ID` and `NEXT_PUBLIC_ANALYTICS_INGEST_KEY` settings, with `site_playground` as the base Site ID fallback. These are client integration settings and may remain available for explicit Playground setup.
- `.env.example` documents the sample Browser SDK settings, shared `LOCAL_DEV_INGEST_KEY`, and `PLAYGROUND_ORIGINS`.
- `pnpm dev:up` and the backend/processing development entry points run seed only with `--seed-init` (or its `--seed` shorthand). Ordinary startup is empty by default.
- `site_playground` also appears in Analytics test fixtures and historical definition import records. Those references are not local development seed wiring and must not be mechanically renamed or deleted.

## Frozen M8.1 contract

- The local development seed continues to create the fixed `site_example` Site. Ordinary startup remains empty; `--seed-init` and its `--seed` shorthand remain the only opt-in seed interface.
- Seed and Playground explicitly share one development-only Ingest Key supplied through `LOCAL_DEV_INGEST_KEY`. M8.2 will map it independently to seed input `DEV_SEED_INGEST_KEY` and browser SDK input `NEXT_PUBLIC_ANALYTICS_INGEST_KEY`; the seed implementation must not read any `NEXT_PUBLIC_*` variable. If `LOCAL_DEV_INGEST_KEY` is unset or blank, explicit seed must fail with a clear error; neither seed nor Compose may silently generate or substitute a credential.
- In the local development Compose overlay, all supported Playground routers explicitly target `site_example`. The seed provisions the `development` policy, which is the policy used by the local Playground workflow; do not add an SDK environment variable or imply that the browser chooses an environment. Browser SDK configuration remains under `NEXT_PUBLIC_ANALYTICS_*` because it is client integration configuration. The base Compose SDK fallback remains available for standalone Playground setup.
- `DEV_SEED_ORIGINS` continues to be sourced from `PLAYGROUND_ORIGINS` (or its existing local defaults). The seed stores only the key digest in the Site policy. The sample key is for local development only and must never be presented as a production credential.
- This preserves the existing Site ID and seed CLI contracts, so no ADR is required. Any future change to either contract must be recorded before implementation.

**M8.1 frozen 2026-10-04.** This documents the selected contract only; no Compose, seed tooling, or runtime configuration was changed as part of M8.1.

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

- [x] Freeze the explicit local seed Site identity and key input independently of Playground `NEXT_PUBLIC_*` variable names.
- [x] Freeze the local Playground SDK target and its explicit mapping to the seeded Site and shared development credential.
- [x] Document that seed and Playground share the explicitly supplied `LOCAL_DEV_INGEST_KEY`, with distinct Compose mappings for seed and browser configuration.
- [x] Freeze missing-key behavior: explicit seed fails clearly when `LOCAL_DEV_INGEST_KEY` is unset or blank; no key is generated or substituted implicitly.
- [x] Freeze local environment behavior: Playground uses the seeded `development` policy without adding environment configuration to the browser SDK.
- [x] Confirm defaults: ordinary startup creates no Site; explicit seeding remains opt-in; sample credentials are development-only.
- [x] Confirm the existing fixed `site_example` and `--seed-init` / `--seed` contracts remain unchanged; any future change must be recorded before implementation.

**Exit:** The platform seed input and observed-client SDK configuration have distinct, documented ownership and invocation paths.

### M8.2 — Remove implicit Playground inputs from platform initialization

- [x] Update Compose and seed tooling so DB initialization does not consume Playground `NEXT_PUBLIC_ANALYTICS_SITE_ID` or `NEXT_PUBLIC_ANALYTICS_INGEST_KEY` values.
- [x] Ensure the explicit seed remains repeatable, preserves manually edited configuration, and stores only the Ingest Key digest in the Site policy.
- [x] Keep the development Playground connected to fixed `site_example` through `LOCAL_DEV_INGEST_KEY`, while preserving base Compose's explicit SDK variables and `site_playground` fallback.
- [x] Keep default startup empty and non-seeding; the existing explicit seed option remains unchanged.
- [x] Update `.env.example` and this inventory to describe the new configuration source; broader Getting Started and onboarding documentation remains in M8.4.

**Exit:** Database seed behavior is independent of Playground client variable names, while the documented explicit seed and SDK integration both work.

**Implementation 2026-10-04:** `compose.dev.yaml` maps `LOCAL_DEV_INGEST_KEY` independently to seed and all three Playground SDK configurations. Seed still requires non-blank `DEV_SEED_INGEST_KEY`, uses fixed `site_example`, and writes only its SHA-256 digest and derived key ID. `.env.example` now includes the shared local development input while retaining base Compose SDK settings. The dev-startup E2E now injects `LOCAL_DEV_INGEST_KEY`. Seed unit tests cover digest/key ID generation, plaintext absence, and missing/blank input. Runtime verification is recorded below, followed by M8.3 isolation checks and M8.4 closeout.

### M8.3 — Protect local, CI, and E2E workflows

- [x] Add or update unit tests for seed argument parsing, seed environment/input validation, generated Site/policy values, idempotency, and non-overwrite behavior as applicable to the chosen contract.
- [x] Verify effective Compose configuration for default startup, explicit seed, and each supported Playground router; confirm no unintended Site/key source remains.
- [x] Verify CI and isolated E2E Compose projects do not depend on local seed credentials or a pre-existing local Site.
- [x] Verify local seed does not create raw events, derived analytics facts, or definition revisions.
- [x] Verify `pnpm dev:down` continues to preserve the PostgreSQL volume and ordinary startup does not mutate an existing Registry.

**Exit:** Local default/seeded workflows and CI/E2E remain isolated, and data lifecycle behavior is unchanged.

**M8.3 implementation 2026-10-04:** Expanded seed assertions to cover generated Origins, policy enabled/rate-limit values, and absence of analytics/revision writes. Extended the isolated dev-startup E2E to verify that seeding produces no raw events, persisted derived analytics facts (including dimension daily aggregates), or definition revisions; after manual policy/capability edits, ordinary startup preserves the existing Registry and edits. The same E2E verifies the Site and both manual edits survive `down`/`up`. No CI changes were needed: the CI job invokes this E2E script, which creates a PID-scoped Compose project, uses a generated local-only key, and runs without relying on a pre-existing Site; other E2E projects omit `compose.dev.yaml` and do not run `dev-seed`.

**M8.3 validation 2026-10-04:** `node --test scripts/dev-seed.test.mjs scripts/capability-seed.test.mjs scripts/dev-compose.test.mjs` passed (13/13), including a wrapper-level test that verifies ordinary startup validates Compose and launches `up` without invoking seed. Effective Compose config was checked for ordinary startup, explicit seed, and Next.js/React Router/TanStack Router: ordinary profiles did not activate `dev-seed`; explicit seed mapped the test key to `DEV_SEED_INGEST_KEY`; all three Playground services resolved to `site_example` and the same supplied SDK key. `pnpm e2e:dev-startup` passed all isolated Registry, policy, event-origin, no-seed-write, restart, and volume lifecycle checks, including `dimension_daily` and persistence of manual policy/capability edits after down/up. E2E cleanup removed only project `web-analytics-dev-startup-e2e-<pid>` and its PostgreSQL volume. The E2E uses direct Compose commands to keep its ports and project isolated; the startup wrapper is covered separately by the unit test. M8.4 documentation and full-suite validation are recorded below.

### M8.4 — Documentation and closeout

- [x] Update `.env.example`, Getting Started, Playground instructions, and Site Onboarding design to match the frozen configuration contract.
- [x] Run targeted seed/Compose tests and the documented dev-startup E2E in an available environment.
- [x] Run `pnpm test`, `pnpm check`, `pnpm build`, `pnpm format:check`, `pnpm format:check:docs`, and `git diff --check`; record actual results and existing warnings.
- [x] Confirm no protocol, Analytics API, report, or historical-data behavior changed.
- [x] Update this checklist and the M8 roadmap status with implementation and validation evidence.

**Exit:** Platform initialization no longer depends on Playground SDK environment variables, all supported local workflows are documented and verified, and no unrelated Site/history data was removed.

## Validation record

2026-10-04 — M8.1 contract review: inspected the current seed implementation, base and development Compose configuration, startup argument handling, and local setup documentation. Froze the configuration contract above. This is a design/documentation closeout only; no implementation tests or runtime validation were performed, and M8.2 remains unstarted.

2026-10-04 — M8.2 implementation: updated development Compose, `.env.example`, seed tests, and `e2e-dev-startup` to use `LOCAL_DEV_INGEST_KEY`. Seed preserves fixed Site identity and conflict-do-nothing semantics. See the M8.2 implementation summary above; test and E2E outcomes are appended after execution.

2026-10-04 — M8.2 validation: `node --test scripts/dev-seed.test.mjs` passed (3/3). `pnpm e2e:dev-startup` passed: default startup kept Registry empty; explicit seed initialized `site_example`; configured Origin/key accepted an event and rejected an unlisted Origin; repeat seed preserved manual policy/capability edits; down/up retained the seeded configuration. Effective development Compose config with a sample `LOCAL_DEV_INGEST_KEY` showed the same value at seed and all three Playground SDKs. Full E2E incurred slow registry downloads; no application failures occurred.

2026-10-04 — M8.3 validation: see the M8.3 section above. Unit tests and isolated `pnpm e2e:dev-startup` passed; ordinary startup left a manually configured Registry unchanged, and Compose key/Site mappings were verified across all supported routers. M8.4 remains open.

2026-10-04 — M8.4 closeout: Updated `.env.example`, Getting Started, Router Playground instructions, and Site Onboarding design to distinguish the base Compose/standalone Browser SDK `NEXT_PUBLIC_ANALYTICS_*` settings from the development overlay's shared `LOCAL_DEV_INGEST_KEY`. Documented that ordinary startup remains empty, seed requires an explicit flag and a nonblank key, and SDK values are not database initialization inputs. Validation passed: targeted `node --test scripts/dev-seed.test.mjs scripts/capability-seed.test.mjs scripts/dev-compose.test.mjs` (13/13); `pnpm e2e:dev-startup` (empty/default startup, seeded Origin/key behavior, repeat seed/non-overwrite, existing Registry behavior, and down/up persistence); `pnpm test`; `pnpm check`; `pnpm build`; `pnpm format:check`; `pnpm format:check:docs`; and `git diff --check`. `pnpm check` reported five existing ESLint warnings for unused generated-file disable directives and the dashboard Vitest Vite native-config warning; there were no errors. The M8.4 diff changes only configuration comments/documentation/checklist status; protocol, Analytics API, report semantics, and historical-data behavior were not changed. M8 is complete.
