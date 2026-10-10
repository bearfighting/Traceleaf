# MVP Scope and Freeze Record

> Status: MVP feature scope remains frozen except for the explicitly approved work to prepare and publish the existing Browser SDK. This limited authorization does not approve new Analytics features or expanded product scope; package release acceptance and registry publication are still pending. Formal deployment preparation and open follow-up items are tracked in [Project Status](project-status.md).

## MVP Baseline

MVP delivers one complete browser analytics workflow:

Website → Browser SDK → Navigation API Observer → Event Protocol → Collector → PostgreSQL → Processor → Analytics API → Dashboard

The frozen feature set includes:

- Page Views, Anonymous Visitors, Sessions and Browser Context.
- Referrer, UTM, language, timezone, device, browser and OS dimensions.
- Framework-independent navigation observation through the browser Navigation API; no Router-specific adapters.
- Custom Events, Web Vitals, Conversion and Funnel.
- Country-level Geo reporting.
- Capability configuration, Origin allowlist, Ingest Keys and environment policies.
- Dashboard reporting and configuration workflows.

Geo region/city, Firefox/WebKit browser coverage, multi-organization access, advanced infrastructure and high-scale or real-time processing are outside this MVP baseline.

## Acceptance Record

The frozen product baseline was accepted after the Phase 7 and Phase 8 implementation. The archived plans and acceptance records provide that historical evidence; current verification and release readiness are tracked separately in [Project Status](project-status.md).

The MVP scope remains frozen: the Browser SDK publication authorization is a narrow exception for completing and publishing the existing package, not permission to add Analytics capabilities or broaden product scope. The package has not passed release acceptance and is not cleared for immediate registry publication. This freeze records the product baseline; it does not claim production operations or public SDK publication have been validated.

## Deferred Work

Performance optimization, production operations, retention policy, live Geo evaluation and recovery exercises are tracked separately in [Project Status](project-status.md). Browser SDK publication preparation is approved within the stated exception; its acceptance and actual release remain tracked there separately from product deployment acceptance.
