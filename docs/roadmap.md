# Roadmap

## Current Status

Phase 0–8 remains the frozen product baseline. M6 Site onboarding slices M6.0–M6.4 are complete, including integrated acceptance from an empty database through event ingestion and Analytics visibility. M2 configuration contracts, runtime views, and the shared capability registry are complete for the current local-development environment. Cross-slice checks and PostgreSQL integration tests pass locally; the current database audit passed with 1 policy document, 7 capability documents, and 0 invalid date-time fields. Strict stored-document date-time validation is enabled. Before deploying this build to any future environment with existing data, run the date-time preflight and remediate findings. See the [M2 implementation checklist](m2-implementation-checklist.md), [M2.4 parity assessment](m2.4-configuration-parity.md), and [M6 Site Onboarding Checklist](m6-site-onboarding-checklist.md).

The detailed phase plans and acceptance records are preserved in the [archive](archive/README.md). The current feature baseline is in [MVP Scope](mvp-scope.md). The Dashboard Settings navigation and five Site-scoped task pages (Overview, Capabilities, Environments & Origins, Ingest Keys, and Definitions) have been delivered through M7c.1–M7c.5. M7c.6 closeout checks pass, including Dashboard tests, project checks/build, formatting, Dashboard E2E, and Site Onboarding E2E. Manual screen-reader announcement review remains deferred. See the [M7c Settings Checklist](m7c-settings-checklist.md) for the recorded results and deferred acceptance.

## Next

Run the frozen product baseline and gather real usage feedback. Complete the deferred manual screen-reader announcement review for M7c.6 as part of accessibility acceptance. Decide which operational and product extensions to pursue from the [Post-MVP Follow-up](post-mvp-follow-up.md); that list is deferred work, not a committed Phase 9 schedule.
