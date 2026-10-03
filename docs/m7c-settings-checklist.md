# M7c Site Settings Checklist

- Status: M7c.1–M7c.6 complete (2026-10-03); optional manual Firefox + Orca announcement review remains a follow-up
- Prerequisites: M6 Site onboarding complete; M7a Dashboard UI foundation complete; Site Management and configuration APIs available
- Scope: Organize existing Site configuration and onboarding status into task-focused Settings pages
- Design references: [Platform Improvement Roadmap](platform-improvement-roadmap.md), [Dashboard UI Improvements](dashboard-ui-improvements.md), [Site Onboarding and Settings Design](site-onboarding-settings-design.md), [M6 Site Onboarding Checklist](m6-site-onboarding-checklist.md)

## Goal

Help an administrator understand a Site's setup and manage its configuration through a clear, Site-scoped Settings area. Preserve the current API ownership, authorization boundary, one-time secret behavior, and runtime application semantics.

## Boundaries

- Do not change Site Management, configuration, Analytics API, persistence, or event protocol contracts as part of the UI reorganization.
- Keep the deployment-admin token server-side. Browser mutations continue through same-origin Dashboard routes.
- Treat stored setup readiness, effective runtime application, and Page View receipt as separate facts.
- The existing cumulative Page Views overview is Site-level evidence; it cannot identify the environment that received an event.
- Do not add URL reachability probes, domain ownership challenges, multi-user identity/RBAC, physical deletion, or synthetic analytics data. These are separately planned work.
- Preserve onboarding behavior and the distinction between empty Registry, needs-attention legacy Sites, unauthorized management access, and unavailable services.

## Settings information architecture

| Page                   | Responsibility                                                                      | Existing behavior to preserve                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Overview               | Site identity, URL, lifecycle, environment summary, setup/runtime/first-event state | M6 connection status and Site-level Page Views evidence                                                           |
| Capabilities           | Capability enablement and dependency guidance                                       | Manifest-aligned options, optimistic concurrency, applied/pending/stale states, legacy create-only initialization |
| Environments & Origins | Environment policy and allowed Origin configuration                                 | Per-environment policy state, Origin validation, activation behavior                                              |
| Ingest Keys            | Create, inspect metadata, rotate, and revoke keys                                   | Plaintext shown once, replacement verification before revoking prior key, no plaintext persistence/logging        |
| Definitions            | Conversion and funnel definitions and revision history                              | Versioning, validation, historical query behavior, no implicit historical backfill                                |

The Site Registry remains the only source for Site selectors. The first Environment remains explicit; the currently configured default environment can remain until a separate environment-selection decision is implemented.

## Delivery checklist

### M7c.1 — Site-scoped navigation and routing

- [x] Add Settings navigation for Overview under the existing Settings primary navigation. Enable Capabilities, Environments & Origins, Ingest Keys, and Definitions when their pages are delivered in M7c.2–M7c.5.
- [x] Add a Site-scoped secondary navigation and breadcrumb that identify the selected Site and current task.
- [x] Keep Analytics Sidebar out of Settings and preserve the selected Site when switching between Analytics and Settings.
- [x] Support direct links, refresh, and browser back/forward for Site and Settings page selection through URL-addressable selection and native Next.js navigation.
- [x] Use Site Registry results for the Site selector; preserve explicit empty, archived, and needs-attention states.

### M7c.2 — Overview and connection status

- [x] Show Site ID, display name, Website URL, lifecycle, setup readiness, and relevant Environment summary.
- [x] Show capability and ingest-policy effective states with clear applied, pending, stale, missing, and error distinctions.
- [x] Show waiting-for-first-event separately from runtime readiness and show Page Views evidence with its Site-level/all-environments limitation.
- [x] Provide the existing refresh/retry actions and useful links to the page that can resolve an incomplete setup.
- [x] Keep missing credentials, rejected credentials, unavailable Site Management API, unavailable Analytics API, empty Registry, and archived Site states distinct.

Implementation note (2026-10-02, updated 2026-10-03): Overview presents Site identity/readiness and selected Environment, separates Site Management API, Analytics API, and Site-level Page View evidence, and links setup gaps to the relevant task pages. Management API health is explicitly marked unchecked when no default Environment is configured. Archived Sites suppress setup-resolution links because they cannot receive new events. Configuration editors moved to their task pages in M7c.3–M7c.5. Tests assert the Site summary fields, Environment selection, Analytics failure visibility alongside missing management credentials, human-readable current/pending/stale runtime states for capabilities and policy, hidden setup-resolution links for archived Sites, and the unchecked management API status without an Environment.

### M7c.3 — Capabilities and environment policy

- [x] Move capability controls to the Capabilities page and keep capability dependencies sourced from the canonical manifest/server validation.
- [x] Preserve optimistic concurrency and display API validation/conflict failures without discarding safe form values.
- [x] Keep legacy missing-capability recovery create-only and do not imply that an existing configuration can be overwritten through initialization.
- [x] Move environment selection, ingest enablement, Allowed Origins, and policy controls to Environments & Origins.
- [x] Make the selected Environment explicit and show its effective Collector application state separately from stored values.
- [x] Keep Origin validation, authorization, and activation rules enforced by the existing service contracts.

Implementation note (2026-10-02): Added directly addressable Capabilities and Environments & Origins pages with URL-preserved Site/Environment context and active task navigation. Capabilities can load without a configured default Environment; environment names are editable and submitted to the URL before the policy is loaded. Capability dependency guidance and availability are sourced from `protocol/capabilities/capabilities.json`. At this step Overview retained key controls and Definitions; M7c.4 moved key controls to their own page. No public API or persistence contracts changed.

### M7c.4 — Ingest Key lifecycle

- [x] Move key metadata and lifecycle controls to `/dashboard/settings/ingest-keys`, scoped to the selected Site and Environment.
- [x] Show newly created/replacement plaintext only in the immediate success response and never in URLs, persistent browser storage, logs, or page reload output.
- [x] Provide a safe replacement flow: create replacement, show it once, allow verification/cutover, then require explicit confirmation before revoking the prior key.
- [x] Handle an ambiguous create response without replaying it as if the secret could be recovered; persist only the Site/Environment review marker and require a refreshed key list before an administrator clears it.
- [x] Preserve active key identifiers and creation times without exposing secret digests; the API does not provide revoked-key history.

Implementation note (2026-10-02, updated 2026-10-03): Ingest key management now has a directly addressable Settings page, carries Site and Environment context through navigation and environment entry, and uses the existing policy version for key creation and revocation. Overview keeps setup status and links to the task pages. No public API, configuration schema, persistence, or onboarding flow changed.

Verification (2026-10-02): The M7c.4 implementation passed `pnpm --filter @web-analytics/dashboard test` (35 files, 170 tests), `pnpm check`, `pnpm build`, `pnpm e2e:dashboard`, `pnpm e2e:site-onboarding`, `pnpm format:check`, and `pnpm format:check:docs`. Dashboard E2E covered the new route, replacement, explicit revocation, and a server-created key whose response was dropped; the page required a refreshed key list and explicit administrator review before allowing another create. Follow-up fixes passed Dashboard tests (37 files, 173 tests), `pnpm check`, `pnpm build`, and `pnpm format:check:docs`; the new tests cover URL-driven Environment input reset and a confirmed creation with a failed policy refresh, including prevention of duplicate creation until refresh succeeds.

### M7c.5 — Definitions

- [x] Move conversion and funnel editing to Definitions and show the current revision and available history.
- [x] Preserve server-side validation, optimistic concurrency, and clear conflict/error feedback.
- [x] State whether a change affects future processing or historical queries; do not imply automatic backfill where none occurs.
- [x] Keep definitions errors separate from missing capability or empty Analytics data.

Implementation note (2026-10-03): Added the directly addressable `/dashboard/settings/definitions` page and moved the existing editor out of Overview. Site and reporting context are preserved in navigation; stored revisions show their effective times and link to historical Analytics reports. Revision history request/response failures remain distinct from an empty history, and definition management stays available without a configured default Environment. Successful saves refresh the page history while preserving the success message. No public API or storage contract changed.

Verification (2026-10-03): Dashboard unit/component tests (39 files, 184 tests), TypeScript, ESLint, Prettier, `git diff --check`, and `pnpm e2e:dashboard` passed. Dashboard E2E covers the directly addressable Definitions route, saved revision history refresh, server validation, conflict recovery, and unchanged historical facts after definition edits. M7c.6 remains responsible for the full responsive, accessibility, route, build, and regression closeout.

### M7c.6 — Responsive UI, tests, and closeout

- [x] Verify Site navigation and Settings forms at desktop and narrow mobile viewport sizes. (Dashboard E2E verifies Capabilities, Environment policy, Ingest Keys, and Definitions sections, representative controls, section bounds, and page overflow at 1440px and 390px. At 390px it also checks the Ingest Keys section while showing its one-time secret.)
- [x] Verify keyboard navigation, focus visibility, semantic labels, breadcrumbs, active states, and screen-reader status semantics. (Dashboard E2E verified Settings link keyboard navigation, visible keyboard focus, current-page state, and breadcrumb context. Component tests cover live status semantics and updates. Actual speech output review with Firefox + Orca was not performed and remains a non-blocking follow-up.)
- [x] Add or update tests for every Settings route, Site/environment context, status precedence, configuration update/recovery, and one-time key lifecycle. (Added task-page rendering/context and policy-unavailable coverage; existing Overview, Definitions, configuration editor, key manager, and E2E scenarios cover the remaining behavior.)
- [x] Run Dashboard tests, `pnpm check`, `pnpm build`, `pnpm e2e:dashboard`, `pnpm e2e:site-onboarding`, `pnpm format:check`, and `pnpm format:check:docs`.
- [x] Record each command and its actual result below; mark only executed and passing items complete.
- [x] Update the Dashboard UI plan, roadmap, and this checklist with the delivered navigation and any deferred items.

## Exit criteria

- Each supported Site configuration task has a clear, directly addressable Settings page.
- Site and Environment context stay visible and correct while navigating, refreshing, and submitting changes.
- Administrators can distinguish saved configuration, runtime application, first-event evidence, and operational errors.
- Key rotation remains one-time and recoverable without replaying plaintext; all changes use existing server-side authorization and API contracts.
- Analytics and Settings behavior remain covered by tests and documented E2E workflows.

## Validation record

2026-10-03 — M7c.6 acceptance:

- `pnpm --filter @web-analytics/dashboard test` — passed (40 files, 188 tests).
- `pnpm check` — passed; 5 existing unused ESLint-disable warnings in generated protocol files, no errors.
- `pnpm build` — passed; all five Settings task routes were included in the Dashboard build.
- `pnpm format:check` — passed.
- `pnpm format:check:docs` — passed.
- `E2E_POSTGRES_PORT=15445 pnpm e2e:dashboard` — passed; verified Settings navigation and Capabilities/Environment/Ingest Keys/Definitions section bounds and representative controls at 1440px and 390px, including the one-time key state, keyboard focus and navigation, task context, dashboard reports, configuration edits, and key lifecycle.
- `E2E_POSTGRES_PORT=15445 pnpm e2e:site-onboarding` — passed; verified empty-database onboarding through event ingestion and Settings evidence, plus missing/invalid credential and unavailable management API states.
- Responsive and keyboard browser assertions in `scripts/e2e-dashboard.mjs` passed, including 1440px and 390px bounds/overflow checks for all form-bearing Settings tasks. Manual screen-reader review remains outstanding and is deferred.

2026-10-03 — M7c.6 screen-reader announcement audit:

- Available local combination: Firefox and Orca on the existing Wayland desktop session. The binaries and graphical session are present, but this agent interface provides no desktop interaction or audio/speech output channel; consequently no Settings interaction was performed with Firefox+Orca and no announcement result is claimed.
- Reviewed the announcement targets in code: configuration save feedback uses `role="status"`; form/service failures use `role="alert"`; runtime effective-state changes previously had no live region. The Ingest Key notice previously put the plaintext secret inside its live region, which could cause it to be spoken aloud immediately.
- Fixes: the runtime effective-state summary now uses `role="status"` with `aria-atomic="true"`, and refreshed runtime state is synchronized into the mounted editor without replacing the user's form state. A component regression test covers a pending-to-current refresh. The Ingest Key creation prompt now has its own status live region, while the secret remains visible beside it but outside that live region; the secret can be read or copied on demand. Regression assertions cover the runtime transition and ensure the key prompt live region excludes the plaintext. Automated assertions cannot establish announcement timing, clarity, or duplicate speech.
- Optional follow-up when desktop interaction/audio is available: review save success, form validation and service errors, runtime state update, and the newly created one-time key notice with Firefox + Orca. Confirm prompt, clear, non-duplicated announcements and confirm the key is not spoken automatically but remains reachable on demand. This manual speech-output review is not an M7c completion gate.
- `pnpm --filter @web-analytics/dashboard test -- configuration-editor.test.tsx ingest-keys-manager.test.tsx` — passed (the workspace script ran all Dashboard tests: 40 files, 189 tests).
- `pnpm check` — passed; 5 pre-existing unused ESLint-disable warnings in generated protocol files, no errors.
- `pnpm format:check:docs` — passed.
- `git diff --check` — passed.

2026-10-02 — All listed M7c.1 checks completed:

- `pnpm --filter @web-analytics/dashboard test` — passed (35 files, 156 tests after review follow-up).
- `pnpm check` — passed (TypeScript, ESLint, and Rust checks; 5 existing generated-code ESLint warnings, no errors).
- `pnpm build` — passed.
- `pnpm e2e:dashboard` — passed; verified Settings navigation, selected Site context, and full Dashboard workflows.
- `pnpm e2e:site-onboarding` — passed; verified legacy Settings URL, environment context, Page View evidence, and empty/credential/API error states.
- `pnpm format:check` — passed.
- `pnpm format:check:docs` — passed after this record update.

The first Dashboard E2E run exposed a test timing issue: it clicked Analytics while the Settings loading shell was still shown. The E2E now waits for the Settings connection status before checking the Analytics return link.

Review follow-ups (2026-10-02): preserved the selected Environment across Settings → Analytics → Settings and Analytics filter submissions; made both Dashboard and Settings loading headers preserve URL context, including the Suspense fallback; retained Site and reporting context in Settings Registry and Site-selection error states. Unit tests cover both loading shells, the suspended fallback, and the empty, unavailable, and unknown-Site states. Dashboard E2E verifies loaded Settings ↔ Analytics context retention without depending on a loading shell's timing. Dashboard tests passed (35 files, 156 tests), `pnpm check` passed, `pnpm --filter @web-analytics/dashboard build` passed, `pnpm e2e:dashboard` passed, and `pnpm e2e:site-onboarding` passed.

2026-10-02 — M7c.2 validation:

- `pnpm --filter @web-analytics/dashboard test` — passed (35 files, 165 tests).
- `pnpm check` — passed (5 pre-existing generated-code ESLint warnings, no errors).
- `pnpm build` — passed.
- `pnpm format:check` — passed.
- `pnpm format:check:docs` — passed.
- `E2E_POSTGRES_PORT=15445 node ./scripts/e2e-dashboard.mjs` — passed; used an unused local PostgreSQL port because the default 15432 was already occupied. Verified Dashboard workflows, Settings configuration editing, one-time key lifecycle, and API error handling.
- `pnpm e2e:site-onboarding` — passed; verified Site-level Page Views and distinct missing/invalid management credential and unavailable Site Management API states across the onboarding workflow.

2026-10-02 — M7c.3 validation:

- `pnpm --filter @web-analytics/dashboard test` — passed (35 files, 167 tests).
- `pnpm check` — passed (5 existing generated-code ESLint warnings, no errors).
- `pnpm build` — passed; Next.js lists both new Settings routes.
- `pnpm e2e:dashboard` — passed; verified switching the Environment through the editable URL-backed selector, split capability/policy workflows, policy validation and conflict recovery, and continued Overview key lifecycle controls.
- `pnpm e2e:site-onboarding` — passed.
- `pnpm format:check` — passed.
- `pnpm format:check:docs` — passed.
