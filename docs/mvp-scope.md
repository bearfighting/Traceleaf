# MVP Scope and Freeze Record

> Status: Frozen — MVP feature scope and Phase 0–8 implementation are closed. The latest CI pass was reported on 2026-09-27.

## MVP Baseline

MVP delivers one complete browser analytics workflow:

Website → Browser SDK → Router Adapter → Event Protocol → Collector → PostgreSQL → Processor → Analytics API → Dashboard

The frozen feature set includes:

- Page Views, Anonymous Visitors, Sessions and Browser Context.
- Referrer, UTM, language, timezone, device, browser and OS dimensions.
- Next.js, React Router and TanStack Router adapters.
- Custom Events, Web Vitals, Conversion and Funnel.
- Country-level Geo reporting.
- Capability configuration, Origin allowlist, Ingest Keys and environment policies.
- Dashboard reporting and configuration workflows.

Geo region/city, Firefox/WebKit browser coverage, multi-organization access, advanced infrastructure and high-scale or real-time processing are outside this MVP baseline.

## Acceptance Record

Phase 7 and Phase 8 implementation and acceptance are complete. The current CI workflow has passed, including functional checks and E2E jobs, as reported by the project owner. Detailed plans and evidence are in the [archive](archive/README.md).

The MVP scope is frozen: further product features or release requirements need an explicit decision to reopen it. This freeze records the product baseline; it does not claim production operations or public SDK publication have been validated.

## Deferred Work

Performance optimization, production operations, retention policy, live Geo evaluation, recovery exercises and independent SDK publication are tracked separately in [Post-MVP Follow-up](post-mvp-follow-up.md).
