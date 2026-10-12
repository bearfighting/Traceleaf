# ADR-025: Set project version baseline to 1.0.0

- Status: Accepted
- Date: 2026-10-11
- Supersedes: the initial version baseline in ADR-024

## Context

The project is usable for its intended first release. There are no external
users yet, and getting the Browser SDK into a real integration is the next
priority. Keeping every first-party package and service at `0.1.0` no longer
reflects the project's readiness.

## Decision

1. Align first-party package manifests, the Cargo workspace, and the platform
   root version to `1.0.0` as the initial release baseline. This includes
   private workspace packages and playground packages; third-party dependency
   versions and archived experiments are not project release versions.
2. Provide `@traceleaf/browser@1.0.0` as a tarball asset in a GitHub Release
   after its focused release checks pass. Keep it unpublished on npm for now
   and retain `private: true` in its package manifest.
3. Keep the coordinated platform baseline at `1.0.0`, identified by Git tag
   `v1.0.0` when the platform release is prepared. The SDK package version and
   platform tag remain separate release artifacts after this baseline.
4. Continue using the simplified release checks and manual GitHub Release in
   [ADR-024](ADR-024-simplified-sdk-and-platform-releases.md).
5. Keep Event Protocol `schema_version` at `1` under [ADR-023](ADR-023-protocol-version-upgrades-require-explicit-approval.md).

## Consequences

- The first SDK release will be a stable `1.0.0` GitHub Release tarball,
  suitable for installing in a real application.
- Current release automation does not publish the platform. Creating the
  `v1.0.0` tag should wait until the coordinated platform release checks and
  deployment readiness are complete.
- Browser support validation and target deployment compatibility evidence
  remain separately tracked; publishing the SDK does not claim those checks
  have passed.
