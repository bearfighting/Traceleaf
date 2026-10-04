# M7b Analytics Reports Checklist

- Status: In progress
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
- [x] Keep page titles, headings, form labels, active navigation, and status messages semantically accessible.
- [ ] Check filter wrapping, table overflow, focus visibility, and direct-link behavior at desktop and mobile viewport sizes.

The remaining browser and assistive-technology checks are deferred to [Final Product Acceptance](platform-improvement-roadmap.md#最终产品验收跨-m-阶段). They require a configured Site Registry and an accessible Analytics report; do not mark them complete based on source or unit-test review alone.

### M7b.5 — Tests and closeout

- [x] Audit existing tests for report route selection, query parameter preservation, page-specific filter visibility, report state distinctions, and navigation history; the current Dashboard unit tests cover these contracts without requiring duplicate tests.
- [ ] Verify Site and date context survive report navigation and refresh; verify incompatible parameters do not mislead users.
- [ ] Run Dashboard tests, `pnpm check`, `pnpm build`, `pnpm e2e:dashboard`, `pnpm format:check`, and `pnpm format:check:docs`.
- [x] Record each command and its actual result below; mark only executed and passing items complete. Dashboard E2E remains deferred and is not counted as a pass.
- [x] Update the Dashboard UI plan, roadmap, and this checklist with the delivered routes and deferred items.

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
- 2026-10-03 — M7b.4 review found that the Sidebar visual active-state selector targeted `aria-current="location"` while report links expose `aria-current="page"`. Updated the selector and added a regression test; this keeps the visible active report state aligned with its assistive-technology state.
- 2026-10-03 — M7b.4 `pnpm --filter @web-analytics/dashboard test`: passed (41 files, 206 tests); `pnpm --filter @web-analytics/dashboard typecheck`: passed; `pnpm check`: passed with the same 5 existing generated-file ESLint warnings; `pnpm build`: passed; `pnpm format:check`: passed; `pnpm format:check:docs`: passed; `git diff --check`: passed.
- 2026-10-03 — M7b.4 headless Chromium smoke check at 320, 390, 768, 1023, 1024, and 1440px against the locally running Dashboard returned no document/body horizontal overflow; the page title heading stayed visible. At 390px, keyboard focus on Analytics showed a solid 3px outline. The available page was the Site Registry configuration error state (`DASHBOARD_CONFIG_ADMIN_TOKEN` is not configured), so these measurements do not verify the Analytics Sidebar, filter wrapping, report tables, or the 1023/1024px Sidebar switch.
- 2026-10-03 — Firefox + Orca report-navigation and status-announcement review not completed: the local Dashboard has no report content because Site management is not configured. The unavailable Firefox + Orca run is not counted as verified. Docker was not started or resumed. M7b.4 responsive report interaction and direct-link checks remain open; M7b.5 closeout remains untouched.
- 2026-10-03 — Follow-up review fixes: all report data tables now expose a keyboard focus target while retaining native table and caption semantics; Overview and each report route set a descriptive document title from the shared report copy. Dashboard tests passed (42 files, 213 tests), typecheck and build passed. Live narrow-screen table scrolling and Firefox + Orca interaction remain unverified because the local Site Registry is unconfigured.
- 2026-10-03 — Follow-up verification: `pnpm check`, `pnpm format:check`, `pnpm format:check:docs`, and `git diff --check` passed. The same 5 existing generated-file ESLint warnings remain. `pnpm e2e:dashboard` was not run; Docker remained untouched.
- 2026-10-03 — Final review aligned Site Registry unavailable/empty-state H1 and description with the selected report and its document title; added a server-rendered regression test. Final Dashboard tests passed (42 files, 213 tests), `pnpm check`, `pnpm build`, formatting checks, and `git diff --check` passed.
- 2026-10-03 — Full workspace `pnpm test` passed, including Rust workspace tests, protocol and contract validation, all package tests, 213 Dashboard tests, and script tests. PostgreSQL integration tests were ignored by the suite because they require a migrated PostgreSQL service. Dashboard browser E2E was not run because its script starts Docker Compose services; Docker was left untouched.
- 2026-10-03 — M7b.5 coverage audit: `analytics-sidebar.test.tsx` checks grouped report routes and accessible current-page state; `settings-routes.test.ts` checks shared Site/date/environment context, compatible Dimension and definition revision propagation, and omission of incompatible report filters; `query-params.test.ts` and `dashboard-page-data.test.ts` cover query parsing and report selection/validation; report section and state tests cover distinct report outcomes. `scripts/e2e-dashboard.mjs` contains Site/date navigation, refresh-by-direct-reload entry, browser back/forward, filter submission, and report-specific Dimension selection flows. This was a source audit, not a browser execution. The previously recorded Dashboard test run (42 files / 213 tests), check, build, formatting checks, and `git diff --check` provide current code verification evidence; no code or tests changed in this closeout.
- 2026-10-03 — `pnpm e2e:dashboard` deferred: the script starts isolated Docker Compose services, and the active instruction is to keep Docker unchanged. No E2E pass is claimed. M7b.5 and M7b remain open pending browser E2E; M7b.4 real Firefox/Orca and responsive report acceptance remains under Final Product Acceptance.
- 2026-10-03 — Documentation closeout verification: `pnpm check`, `pnpm build`, `pnpm format:check`, `pnpm format:check:docs`, and `git diff --check` passed after the documentation updates. `pnpm check` reported the same 5 existing unused ESLint disable warnings in generated protocol files. No Dashboard tests were rerun because this closeout changed documentation only; the previously recorded 42-file / 213-test Dashboard run remains the test evidence. `pnpm e2e:dashboard` was not run and Docker was left untouched.
