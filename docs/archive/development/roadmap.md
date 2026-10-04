# Roadmap

## Current Status

Phase 0–8 remains the frozen product baseline. M6 Site onboarding slices M6.0–M6.4 are complete, including integrated acceptance from an empty database through event ingestion and Analytics visibility. M2 configuration contracts, runtime views, and the shared capability registry are complete for the current local-development environment. Cross-slice checks and PostgreSQL integration tests pass locally; the current database audit passed with 1 policy document, 7 capability documents, and 0 invalid date-time fields. Strict stored-document date-time validation is enabled. Before deploying this build to any future environment with existing data, run the date-time preflight and remediate findings. See the [M2 implementation checklist](m2-implementation-checklist.md), [M2.4 parity assessment](m2.4-configuration-parity.md), and [M6 Site Onboarding Checklist](m6-site-onboarding-checklist.md).

The detailed phase plans and acceptance records are preserved in the [archive](../README.md). The current feature baseline is in [MVP Scope](../../mvp-scope.md). M7c Settings navigation, five Site-scoped task pages, and M7c.6 automated closeout are complete. Responsive, keyboard, project, build, formatting, Dashboard E2E, and Site Onboarding E2E checks pass. Runtime status has atomic live status semantics and a regression assertion that refresh updates the mounted editor. Manual Firefox + Orca speech-output review remains a non-blocking accessibility follow-up. M7b.1 Analytics report routes and navigation are delivered; shared filter refinement and remaining acceptance are in progress. See the [M7b checklist](m7b-analytics-reports-checklist.md).

## Next

Continue M7b Analytics Reports from M7b.2 using its checklist. The Firefox + Orca speech-output review is optional follow-up work. After M7b, run the frozen product baseline and gather real usage feedback. Decide which operational and product extensions to pursue from the [Project Status](../../project-status.md); that list is deferred work, not a committed Phase 9 schedule.
