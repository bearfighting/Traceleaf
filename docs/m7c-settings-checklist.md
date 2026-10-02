# M7c Site Settings Checklist

- Status: M7c.1 complete; M7c.2–M7c.6 planned (2026-10-02)
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

- [ ] Show Site ID, display name, Website URL, lifecycle, setup readiness, and relevant Environment summary.
- [ ] Show capability and ingest-policy effective states with clear applied, pending, stale, missing, and error distinctions.
- [ ] Show waiting-for-first-event separately from runtime readiness and show Page Views evidence with its Site-level/all-environments limitation.
- [ ] Provide the existing refresh/retry actions and useful links to the page that can resolve an incomplete setup.
- [ ] Keep missing credentials, rejected credentials, unavailable Site Management API, unavailable Analytics API, empty Registry, and archived Site states distinct.

### M7c.3 — Capabilities and environment policy

- [ ] Move capability controls to the Capabilities page and keep capability dependencies sourced from the canonical manifest/server validation.
- [ ] Preserve optimistic concurrency and display API validation/conflict failures without discarding safe form values.
- [ ] Keep legacy missing-capability recovery create-only and do not imply that an existing configuration can be overwritten through initialization.
- [ ] Move environment selection, ingest enablement, Allowed Origins, and policy controls to Environments & Origins.
- [ ] Make the selected Environment explicit and show its effective Collector application state separately from stored values.
- [ ] Keep Origin validation, authorization, and activation rules enforced by the existing service contracts.

### M7c.4 — Ingest Key lifecycle

- [ ] Move key metadata and lifecycle controls to Ingest Keys, scoped to the selected Site and Environment.
- [ ] Show newly created/replacement plaintext only in the immediate success response and never in URLs, persistent browser storage, logs, or page reload output.
- [ ] Provide a safe replacement flow: create replacement, show it once, allow verification/cutover, then require explicit confirmation before revoking the prior key.
- [ ] Handle an ambiguous create response without replaying it as if the secret could be recovered; explain replacement-key recovery.
- [ ] Preserve key identifiers, lifecycle status, and audit behavior without exposing secret digests.

### M7c.5 — Definitions

- [ ] Move conversion and funnel editing to Definitions and show the current revision and available history.
- [ ] Preserve server-side validation, optimistic concurrency, and clear conflict/error feedback.
- [ ] State whether a change affects future processing or historical queries; do not imply automatic backfill where none occurs.
- [ ] Keep definitions errors separate from missing capability or empty Analytics data.

### M7c.6 — Responsive UI, tests, and closeout

- [ ] Verify Site navigation and Settings forms at desktop and narrow mobile viewport sizes.
- [ ] Verify keyboard navigation, focus visibility, semantic labels, breadcrumbs, active states, and screen-reader status updates.
- [ ] Add or update tests for every Settings route, Site/environment context, status precedence, configuration update/recovery, and one-time key lifecycle.
- [ ] Run Dashboard tests, `pnpm check`, `pnpm build`, `pnpm e2e:dashboard`, `pnpm e2e:site-onboarding`, `pnpm format:check`, and `pnpm format:check:docs`.
- [ ] Record each command and its actual result below; mark only executed and passing items complete.
- [ ] Update the Dashboard UI plan, roadmap, and this checklist with the delivered navigation and any deferred items.

## Exit criteria

- Each supported Site configuration task has a clear, directly addressable Settings page.
- Site and Environment context stay visible and correct while navigating, refreshing, and submitting changes.
- Administrators can distinguish saved configuration, runtime application, first-event evidence, and operational errors.
- Key rotation remains one-time and recoverable without replaying plaintext; all changes use existing server-side authorization and API contracts.
- Analytics and Settings behavior remain covered by tests and documented E2E workflows.

## Validation record

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
