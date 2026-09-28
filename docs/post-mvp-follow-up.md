# Post-MVP Follow-up

> Status: Deferred. Revisit after the product is running and real operating needs are known. This is a tracking list, not a launch checklist or a committed schedule.

## Performance and CI

- Review the existing Analytics, Dashboard and Configuration E2E measurement artifacts.
- Decide whether local Docker cache diagnostics or CI cross-run BuildKit caching are worth further work.
- Compare measured time and network/build logs before changing CI caching. The current CI and E2E jobs still need to pass; performance analysis is deferred.

## Collector Operations

- Evaluate production failure recovery, request/database/shutdown timeouts, SIGTERM behavior, readiness, redacted diagnostics and rate limiting.
- Separate product correctness regressions from additional production hardening.

## Data Retention

- Define retention for raw events, context, facts and aggregates, including deletion order, dry-run impact and consistency checks.
- The existing one-year configuration audit expiry and daily purger remain as implemented. This follow-up does not change that behavior or add analytics-data deletion.

## Country Geo Operations

- After live use, measure country resolution coverage and unknown share with representative traffic.
- Validate the operator-managed MMDB update and rollback process and confirm raw IP is not persisted or logged.
- Reassess Geo region/city only after reviewing country-level value, data quality and privacy implications.

## Production Deployment and Recovery

- Exercise production migration, database backup/restore and service image rollback in the chosen deployment environment.
- Refine deployment and recovery procedures from those exercises.

## SDK Publication

- Decide whether internal workspace runtime dependencies will be published separately or bundled.
- Verify the package from an independent consumer, then decide versioning, release metadata, tags and publication workflow.

## Other Deferred Scope

- Firefox/WebKit browser coverage.
- Replay, Heatmap, advanced Geo and other product extensions. Reassess against user feedback before planning implementation.
