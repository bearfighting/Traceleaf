# M6 Site Onboarding Checklist

- Status: M6.0 complete; M6.1–M6.4 planned
- Prerequisites: M5 Site Management backend complete; M7a Dashboard UI foundation complete
- Scope: Empty-site local development workflow and Dashboard onboarding for creating and connecting Sites
- Design references: [Platform Improvement Roadmap](platform-improvement-roadmap.md), [Site Onboarding and Settings Design](site-onboarding-settings-design.md), [Dashboard UI Improvements](dashboard-ui-improvements.md), [M5 Site Management Backend Checklist](m5-site-management-checklist.md)

## Goal

A new local installation can start with an empty Site Registry, and an administrator can create and connect the first observed website through Dashboard. Existing Sites and Analytics history remain available. A demo Site is created only through an explicit local seed option.

M6 consumes the M5 Site Management and configuration contracts. It does not add Site persistence or management API behavior. Settings information architecture and report-page redesign are tracked in M7c and M7b respectively.

## Frozen behavior and boundaries

- Ordinary `pnpm dev:up` starts without creating or requiring a demo Site. It must work with a fresh database and must not erase or rewrite Sites in an existing database volume.
- `pnpm dev:up --seed-init` explicitly creates the fixed local demo Site and its `development` environment policy. `--seed` is a documented shorthand. Seeding is idempotent and does not overwrite hand-edited configuration or create analytics events.
- `pnpm dev:down` preserves database volumes. Resetting local data, if needed, remains a separate explicit destructive operation.
- The Site Registry API is the source for Dashboard Site lists and selectors. Remove runtime dependence on `DASHBOARD_SITES`, `DASHBOARD_DEFAULT_SITE`, and `DASHBOARD_DEFAULT_ENVIRONMENT` as M6 migrates the UI.
- `CONFIG_ADMIN_TOKENS` and `DASHBOARD_CONFIG_ADMIN_TOKEN` are deployment-admin credentials. The Dashboard token remains server-side and is never sent to browser code or included in client-visible page data.
- Missing Dashboard admin credentials, rejected credentials, unavailable management API, an empty Site Registry, and a Registry containing Sites are distinct states. Do not treat an auth/service error as an empty Registry.
- Site URL is informational metadata. Allowed Origins control ingest acceptance. An HTTP reachability probe or domain ownership claim is outside M6.
- The create response's Ingest Key is shown once. Do not persist it in local storage, cookies, URLs, analytics events, logs, or server rendered output. A same-key replay does not recover the key; explain replacement-key recovery if the initial response is lost.
- Setup readiness, runtime configuration application, and receipt of the first event are separate states. Use the existing Site, capability, policy effective-state, and Analytics contracts; never label stored configuration as active before affected services report it applied.
- Restoring a Site or enabling an environment is an explicit management action. Onboarding must not silently unarchive a Site or enable a policy.

## Delivery slices

### M6.0 — Explicit empty and demo local startup

- [x] Change local development Compose startup to default to an empty Registry without starting `dev-seed` as a backend or Playground dependency.
- [x] Add `--seed-init` and `--seed` options to all local backend Compose entry points and document the behavior.
- [x] Keep seed limited to the fixed `site_example`, capability defaults, `development` policy, and local key digest; do not emit synthetic analytics events.
- [x] Make seed safe to repeat and non-destructive to existing/manual configuration.
- [x] Confirm `pnpm dev:down` leaves the PostgreSQL volume intact; data reset remains a separate destructive operation.
- [x] Ensure CI and isolated E2E Compose projects do not depend on the optional development seed.

**M6.0 validation (2026-10-01):** `pnpm e2e:dev-startup` passed in an isolated Compose project: backend services, Dashboard and Next.js Playground were healthy with an empty Registry by default; explicit seed created the fixed Site; only the configured Origin could ingest; seed created no events, preserved manual policy and capability changes on replay, and data survived `down`/`up`. `pnpm test` (including new argument and seed tests), `pnpm test:integration`, `pnpm test:migrations`, `pnpm protocol:validate`, `pnpm check`, `pnpm build`, `pnpm format:check` and `pnpm format:check:docs` passed. `pnpm check` reported five pre-existing generated-code ESLint warnings and no errors.

**Exit:** Fresh ordinary startup reaches healthy services with an empty Registry; explicit seed startup produces the demo Site; existing data survives a normal restart/down-up cycle.

### M6.1 — Server-side Site Management client and directory

- [ ] Add a typed Dashboard client for Site list/detail/create and the existing capability, environment policy, key, and definitions management APIs needed by onboarding.
- [ ] Keep admin credentials in server-only code. Use the existing same-origin server proxy pattern for browser mutations where appropriate; do not expose Analytics API admin routes directly to untrusted browser code.
- [ ] Replace `DASHBOARD_SITES` and default-site configuration with the Site Registry response for Dashboard selectors and pages.
- [ ] Define empty, loading, unauthorized/unconfigured, unavailable, and populated directory states with distinct user guidance.
- [ ] Preserve current Analytics query parameters and historical report behavior when the selected Site comes from the Registry.
- [ ] Show legacy Sites with missing metadata or configuration as repairable `needs_attention` entries without blocking their historical Analytics reports.

**Exit:** Dashboard Site choices are dynamic and API-backed; operational failures cannot masquerade as an empty onboarding state.

### M6.2 — First-Site onboarding and create flow

- [ ] Add an empty-Registry landing state with a clear Add Site action.
- [ ] Build a Site creation flow for display name, Website URL, first environment, Allowed Origins, and optional supported capabilities.
- [ ] Make the distinction between Website URL and the Collector's Allowed Origins clear. Initialize the Origin suggestion from the Website URL and allow edits before submission.
- [ ] Keep capability dependency hints aligned with the canonical capability manifest; rely on the server for final validation.
- [ ] Use a client-generated `Idempotency-Key` for creation. Display field and API validation errors without losing safe form values.
- [ ] On a first successful response, show the Site ID, environment, Origins, and one-time Ingest Key in a dedicated success step with a copy action.
- [ ] Do not automatically replay an ambiguous create and imply the key can be recovered. Explain that a committed request replay returns metadata only and direct the administrator to create a replacement key if the secret was lost.
- [ ] Provide an SDK installation example using the created Site ID, environment, and key; label which values belong in the observed website's configuration.
- [ ] Handle refresh/navigation of the one-time secret step safely; do not claim a lost key can be displayed again.

**Exit:** An administrator can create the first Site from the empty state and leave with the correct client-side setup instructions, while the plaintext key remains one-time.

### M6.3 — Connection and configuration state

- [ ] Show stored Site readiness and missing requirements from the Site API.
- [ ] Show effective capability and ingest-policy application state from the existing configuration APIs, including pending and stale conditions.
- [ ] Show “waiting for first event” separately from configuration readiness; transition to connected only when existing Analytics data provides evidence of ingestion.
- [ ] Provide a useful retry/refresh action and retain a path to configuration when application is pending or policy is incomplete.
- [ ] Represent archived Sites as archived and prevent onboarding UI from implying they are ingestible.
- [ ] Cover missing management credentials, API unauthorized, API unavailable, empty registry, legacy Site needing attention, pending rollout, stale rollout, waiting for event, connected, and archived states.

**Exit:** The user can tell whether setup is incomplete, saved but not applied, applied but not yet receiving events, connected, or unavailable due to an operational error.

### M6.4 — Integrated acceptance and closeout

- [ ] Add an isolated Dashboard onboarding E2E that starts with an empty database and does not use development seed data.
- [ ] Verify first Site creation from Dashboard, one-time key handling, an event sent from an allowed Origin, runtime application, Processor aggregation, and Analytics visibility.
- [ ] Verify denied/unconfigured management access and service-unavailable states render as errors rather than empty onboarding.
- [ ] Verify the explicit demo seed workflow separately, including repeat execution and preservation of manually changed data.
- [ ] Run Dashboard tests, check, build, protocol/contract validation, relevant backend integration tests, and the isolated onboarding E2E using documented project scripts.
- [ ] Update this checklist, the Platform Improvement Roadmap, local development instructions, and onboarding documentation with actual results. Mark only executed and passing items complete.

**M6 exit:** On a fresh local installation, an administrator can create and connect the first observed Site in Dashboard without editing per-Site platform `.env`, Compose, or Collector TOML values. The default development workflow remains empty; demo configuration is opt-in; old Sites and reports remain usable.

## Deferred work

- Tailwind/shadcn, shared visual tokens, Global Header, Analytics Sidebar, and reusable page shell belong to M7a and are M6 prerequisites.
- Moving existing Analytics reports into the M7 report information architecture belongs to M7b.
- Full task-oriented Settings navigation and configuration page reorganization belongs to M7c. M6 only adds the onboarding surfaces and the minimum Site directory/configuration views needed to complete connection.
- URL reachability probes, domain ownership verification, team management/RBAC, physical Site deletion, and synthetic analytics data seeding are not part of M6.

## Decisions to resolve before implementation

- [x] Confirm the exact `pnpm dev:up --seed-init` argument form and the `--seed` shorthand; pnpm passes script flags without an extra `--` separator.
- [ ] Confirm the current Analytics query/API signal used to determine that a first event has arrived. If no suitable signal exists, propose a minimal contract separately before adding new backend behavior.
- [ ] Confirm how the create success step handles a lost response and key replacement without storing the plaintext key or changing M5 idempotency semantics.
