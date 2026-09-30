# Roadmap

## Current Status

MVP is frozen. Phase 0–8 product implementation and acceptance are complete; the latest CI pass was reported on 2026-09-27. No additional MVP feature work is planned. M2 configuration contracts, runtime views, and the shared capability registry are complete for the current local-development environment. Cross-slice checks and PostgreSQL integration tests pass locally; the current database audit passed with 1 policy document, 7 capability documents, and 0 invalid date-time fields. Strict stored-document date-time validation is enabled. Before deploying this build to any future environment with existing data, run the date-time preflight and remediate findings. See the [M2 implementation checklist](m2-implementation-checklist.md) and [M2.4 parity assessment](m2.4-configuration-parity.md).

The detailed phase plans and acceptance records are preserved in the [archive](archive/README.md). The current feature baseline is in [MVP Scope](mvp-scope.md).

## Next

Run the frozen product baseline and gather real usage feedback. Decide which operational and product extensions to pursue from the [Post-MVP Follow-up](post-mvp-follow-up.md); that list is deferred work, not a committed Phase 9 schedule.
