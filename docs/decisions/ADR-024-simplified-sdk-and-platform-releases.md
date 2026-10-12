# ADR-024: Simplified SDK and platform releases

- Status: Accepted; initial version baseline superseded by ADR-025
- Date: 2026-10-11

## Context

The Browser SDK is the only independently installable package. The backend
services and Dashboard currently ship as one repository workflow. Maintaining
nightly, alpha, beta, release-candidate, and per-service version tracks would
add release work without a current operational need.

The project owner requests a simple release process and focused validation for
Browser SDK updates. Protocol V1 is the shared SDK/backend contract; its
version policy is defined in [ADR-023](ADR-023-protocol-version-upgrades-require-explicit-approval.md).

## Decision

1. Publish ordinary Browser SDK versions only. Do not create nightly, alpha,
   beta, or release-candidate versions or tags.
2. The Browser SDK has its own package version. At the time of this decision,
   its package version was `0.1.0`; the initial release baseline is now set by
   ADR-025. Every later publication increments the package version. Do not
   republish an already published version.
3. Keep Collector, Processor, Analytics API, and Dashboard on one platform
   release version/tag while they are released together. Do not maintain
   separate service version streams until independent release is needed.
4. A Browser SDK release runs focused SDK and protocol-contract validation; it
   does not require the full Dashboard or platform E2E suite. Protocol schema
   and fixture validation must cover the shared boundary, with both TypeScript
   and Rust consumers tested when that boundary changes.
5. Distribute SDK releases manually as tarballs attached to GitHub Releases.
   Keep `private: true` in the package manifest and do not publish to npm.
6. Protocol `schema_version` remains 1 unless the project owner explicitly
   requests an upgrade. Definition changes must update canonical schemas,
   examples, fixtures, generated types, and consumers together.

## Operational process

Version ownership, version increments, CI checks, and step-by-step release
procedures are maintained in [Versioning and Release Process](../versioning-and-release-process.md).

## Consequences

- Release operations have one normal SDK version stream and one platform
  version stream instead of pre-release and per-service tracks.
- Protocol compatibility is enforced by shared schemas, fixtures, and
  producer/consumer tests, not by automatically increasing the protocol
  version.
- The package remains private to prevent accidental npm publication; consumers
  install the attached GitHub Release tarball.
- The currently deferred target-deployment Collector compatibility and
  Firefox/Safari/WebKit acceptance remain deferred as recorded in the Browser
  SDK plan.
