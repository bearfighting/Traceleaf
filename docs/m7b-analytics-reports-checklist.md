# M7b Analytics Reports Checklist

- Status: Planned
- Prerequisites: M7a Dashboard UI foundation complete; current Analytics query APIs and report capabilities available
- Scope: Move existing Analytics reports into task-focused pages and make shared filters, navigation, and report states consistent
- Design references: [Platform Improvement Roadmap](platform-improvement-roadmap.md), [Dashboard UI Improvements](dashboard-ui-improvements.md), [M6 Site Onboarding Checklist](m6-site-onboarding-checklist.md)

## Goal

Make every currently supported Analytics report easy to find and understand. Keep report data and meaning on the existing Analytics API; M7b is a Dashboard information-architecture and presentation change.

## Boundaries

- Do not add or change Analytics API contracts, event protocol, Processor semantics, or capability definitions.
- Do not present unsupported capabilities or metrics as available reports.
- Keep the Site Registry as the source for Site choices. Preserve deep links and shareable URL state.
- Keep Settings navigation and configuration workflows in M7c.
- Preserve the existing report behavior and filters unless a documented UI decision changes their presentation.

## Report inventory

| Page          | Existing report content / query                 | Page-specific state                   |
| ------------- | ----------------------------------------------- | ------------------------------------- |
| Overview      | Site summary and Page View overview             | Site and date range                   |
| Pages         | Page View timeline and top pages                | Site and date range                   |
| Dimensions    | Browser, device, and other supported dimensions | Site, date range, dimension           |
| Visitors      | Visitor report                                  | Site and date range                   |
| Sessions      | Session report                                  | Site and date range                   |
| Custom events | Custom event report                             | Site and date range                   |
| Web Vitals    | Web Vitals report                               | Site and date range                   |
| Countries     | Geo country report                              | Site and date range                   |
| Conversions   | Conversion report                               | Site, date range, definition revision |
| Funnels       | Funnel report                                   | Site, date range, definition revision |

The inventory is limited to reports already supported in the Dashboard and Analytics API. Update the mapping if the implemented query names differ; do not add backend work to make the list appear complete.

## Delivery checklist

### M7b.1 — Report routes and navigation

- [x] Create a stable route for Overview and each supported report, reusing the M7a Dashboard shell and Analytics Sidebar.
- [x] Mark the current report in navigation with an accessible current-page state; browser back/forward and direct route loads select the matching item.
- [x] Keep report titles and descriptions in the page content area, separate from navigation and shared filters.
- [x] Keep Settings as a separate primary navigation context without the Analytics Sidebar.
- [x] Remove duplicate full report content from Overview; keep a concise summary and links to detail reports.

### M7b.2 — Shared filters and URL state

- [x] Keep Site and date range filters consistent across report pages and preserve them in shareable URLs.
- [x] Preserve the selected Site when moving between Analytics reports and Settings, where applicable.
- [x] Show Dimension only on Dimensions; show definition revision only on Conversions and Funnels.
- [x] Preserve valid page-specific parameters when navigating between compatible reports; remove or ignore parameters that do not apply to the destination.
- [x] Handle invalid or unknown Site, date, dimension, and definition parameters with the existing explicit validation/error behavior.
- [x] Ensure form submission, route navigation, refresh, and browser history restore the visible filter values.

### M7b.3 — Report content and states

- [x] Move existing report components to their corresponding pages without changing query meaning or capability gating.
- [x] Keep loading, no-data, disabled/missing capability, missing definitions, and Analytics API error states distinct.
- [x] Include relevant Site and date context in report error states and provide a useful route to configuration when a capability or definition is missing.
- [x] Preserve report tables, sorting or other existing interactions, and avoid introducing metrics the API does not provide.
- [x] Ensure Overview remains useful without repeating every report table.

### M7b.4 — Responsive and accessible interaction

- [ ] Verify Sidebar behavior on narrow screens and keep report navigation usable by keyboard and assistive technology.
- [ ] Keep page titles, headings, form labels, active navigation, and status messages semantically accessible.
- [ ] Check filter wrapping, table overflow, focus visibility, and direct-link behavior at desktop and mobile viewport sizes.

### M7b.5 — Tests and closeout

- [ ] Add or update tests for report route selection, query parameter preservation, page-specific filter visibility, report state distinctions, and navigation history.
- [ ] Verify Site and date context survive report navigation and refresh; verify incompatible parameters do not mislead users.
- [ ] Run Dashboard tests, `pnpm check`, `pnpm build`, `pnpm e2e:dashboard`, `pnpm format:check`, and `pnpm format:check:docs`.
- [ ] Record each command and its actual result below; mark only executed and passing items complete.
- [ ] Update the Dashboard UI plan, roadmap, and this checklist with the delivered routes and any deferred items.

## Exit criteria

- Every supported report is reachable from Analytics navigation and direct links.
- Shared Site/date context and applicable report-specific state survive navigation and refresh.
- Overview is concise; each report page has a clear title, query context, and distinct loading/empty/unavailable/error states.
- Responsive and keyboard navigation work, and the existing Analytics API and capability semantics remain unchanged.

## Validation record

- 2026-10-03 — `pnpm --filter @web-analytics/dashboard test`: passed (41 files, 195 tests).
- 2026-10-03 — `pnpm check`: passed. ESLint reports 5 existing unused-directive warnings in generated protocol files.
- 2026-10-03 — `pnpm build`: passed.
- 2026-10-03 — `pnpm format:check`: passed.
- 2026-10-03 — `pnpm format:check:docs`: passed.
- 2026-10-03 — `git diff --check`: passed.
- 2026-10-03 — M7b.3 `pnpm --filter @web-analytics/dashboard test`: passed (41 files, 202 tests); `pnpm --filter @web-analytics/dashboard typecheck`: passed.
- 2026-10-03 — M7b.3 `pnpm check`: passed; ESLint reports 5 existing unused-directive warnings in generated protocol files.
- 2026-10-03 — M7b.3 `pnpm build`: passed.
- 2026-10-03 — M7b.3 `pnpm format:check`: passed; `pnpm format:check:docs`: passed; `git diff --check`: passed.
- 2026-10-03 — M7b.3 `pnpm e2e:dashboard` not run: Docker reports the existing Dashboard E2E PostgreSQL container as paused. Per the active instruction, containers were not resumed; browser E2E remains unverified.
- 2026-10-03 — Follow-up review fixes: Dashboard tests passed (41 files, 204 tests), typecheck, `pnpm check`, build, formatting checks, and `git diff --check` passed.
- 2026-10-03 — Batch-loader follow-up: both batch paths now use the same definition-history status mapping; Dashboard tests passed (41 files, 205 tests), typecheck, `pnpm check`, build, formatting checks, and `git diff --check` passed.
- M7b.3 report states now distinguish API capability-disabled responses, unsupported optional client endpoints, API failures, and empty responses. Conversions and Funnels consult revision history when the API rejects an absent default definition version; an empty successful history links to Definitions, while history errors retain the Site/date-aware error state. Unavailable capabilities link to that Site's Capabilities settings.
- 2026-10-03 — `E2E_POSTGRES_PORT=15445 E2E_CACHE_SCOPE=m7b-fix node ./scripts/e2e-dashboard.mjs`: passed during earlier M7b work. It covers responsive navigation, query context, browser back/forward, filter submission, unknown slugs, all report routes including Dimensions and Language filtering, Phase 6 error/disabled/empty states, configuration workflows, and API errors. It does not verify the M7b.3 changes.
- M7b.1 routes and navigation are implemented.
- 2026-10-03 — M7b.2 implemented typed destination-aware Analytics URL construction, consistent Site/date/environment context, compatible Dimension and definition revision propagation, destination-specific filter controls, and report-specific historical revision links from Definitions.
- 2026-10-03 — M7b.2 verification: `pnpm --filter @web-analytics/dashboard test` passed (41 files, 200 tests); `pnpm check` passed (including format checks; ESLint reports 5 existing generated-file warnings); `pnpm build` passed; `pnpm format:check:docs` passed; `git diff --check` passed.
- 2026-10-03 — `pnpm e2e:dashboard` could not complete because default PostgreSQL port 15432 was already allocated. Two isolated retries using port 15445 completed database migration and seed setup, then stalled during `importDefinitionsIfEmpty`; both were interrupted and their generated containers and volumes were cleaned up. Dashboard E2E remains unverified for this delivery.
