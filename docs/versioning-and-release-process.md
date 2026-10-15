# Versioning and release process

This is the single operational guide for Browser SDK releases and platform
version updates. The decisions are recorded in [ADR-023](decisions/ADR-023-protocol-version-upgrades-require-explicit-approval.md)
and [ADR-024](decisions/ADR-024-simplified-sdk-and-platform-releases.md),
plus [ADR-025](decisions/ADR-025-project-version-baseline-1.0.0.md).

## Version rules

| Area                                             | Version source                            | Update rule                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser SDK                                      | `packages/analytics-browser/package.json` | Independent package version distributed as a tarball attached to a GitHub Release. `1.0.0` is the first release. Keep the package `private: true` to block accidental npm publication.                                                                    |
| Collector, Processor, Analytics API, Dashboard   | One platform version                      | Release together as one platform update. Use one Git tag `vX.Y.Z`; do not create per-service version streams. Keep the root `package.json`, Rust workspace version in `Cargo.toml`, and `apps/dashboard/package.json` aligned with that platform version. |
| Other private workspace packages and Playgrounds | Their package manifests                   | Their manifests are aligned to `1.0.0` for this project baseline, but they are not independently released. Do not bump them for SDK or platform releases.                                                                                                 |
| Event Protocol                                   | Event `schema_version`                    | Keep the unified Protocol at `1`. Update the definition without changing the version unless the project owner explicitly requests an upgrade.                                                                                                             |

Package versions and Git tags identify different artifacts: the SDK package
version identifies a GitHub Release tarball tagged `browser-sdk-vX.Y.Z`;
`vX.Y.Z` identifies one coordinated platform release. First-party package
manifests and the Rust workspace are aligned to `1.0.0` for this initial
baseline; thereafter, only the version owners listed in the table change.

For SDK `1.x` releases, use patch increments for fixes and minor increments
for features; use a major increment for breaking public API changes. Do not
reuse an SDK version already released. Keep release notes short: list the
package version, Git commit, and user-facing changes in the GitHub Release
description; a separate release-management system is unnecessary.

## Browser SDK release

1. Update only `packages/analytics-browser/package.json` to the next SDK
   version. Do not change the Protocol version or unrelated workspace package
   versions for an SDK-only release.
2. Run the focused SDK release checks listed below. The regular PR CI remains
   the repository's existing validation; an SDK release does not need a
   second full Dashboard/platform E2E run.
3. If the change affects navigation observation, default transport, CORS, or
   Collector ingestion, also run `pnpm e2e:browser-sdk`.
4. Keep `private: true`. Run package acceptance in its default mode, then create
   a `.tgz` with `npm pack` from the validated commit. Store the generated
   asset under ignored `artifacts/releases/` so it is ready to attach:

   ```sh
   mkdir -p artifacts/releases
   cd packages/analytics-browser
   npm pack --pack-destination ../../artifacts/releases
   ```

5. In the GitHub Releases page, create a release using tag
   `browser-sdk-vX.Y.Z` on the validated commit. Attach the tarball and include
   the version, commit, and user-facing changes. Do not publish the package to
   npm. Consumers download it and run `npm install ./traceleaf-browser-X.Y.Z.tgz`.

The focused checks are:

```sh
pnpm protocol:validate
pnpm http:validate
pnpm --filter @web-analytics/protocol-ts --filter @web-analytics/observer-core --filter @web-analytics/analytics-core --filter @traceleaf/browser --filter @web-analytics/transport test
pnpm --filter @web-analytics/protocol-ts --filter @web-analytics/observer-core --filter @web-analytics/analytics-core --filter @traceleaf/browser --filter @web-analytics/transport typecheck
pnpm --filter @traceleaf/browser build
pnpm --filter @traceleaf/browser package:acceptance
```

The acceptance script verifies that the packed manifest remains private and
runs isolated ESM, TypeScript, and Vite consumer checks against the tarball.

If the Protocol or ingestion contract changes, also run the Collector HTTP
contract suite:

```sh
cargo test -p collector --test http_ingestion
```

The repository currently has no `sdk:verify` wrapper. If repeated manual
commands become inconvenient, they can later be grouped under one command;
this is optional and must not create a GitHub Release automatically.

The current pull request CI still runs the repository-wide check, build, test,
and PostgreSQL integration jobs. This guide keeps the additional manual SDK
release gate focused; narrowing existing CI for SDK-only changes would require
a separate CI change.

## Platform version update

1. Choose the next platform version and use it for the root `package.json`,
   `Cargo.toml` workspace package version, and `apps/dashboard/package.json`.
   Private leaf packages and examples retain the initial `1.0.0` baseline.
2. Create one Git tag `vX.Y.Z` on the validated commit. The existing CI
   `v*` trigger runs full repository validation for this coordinated release.
   After it passes, CI publishes run-specific GHCR candidate manifests for
   Collector, Processor, Analytics API, DB tools, and Dashboard.
3. CI pulls and runs the candidates on native AMD64 and ARM64 runners. Only
   after both isolated Compose smoke checks pass does CI promote those exact
   manifest digests to `sha-<commit>` and `vX.Y.Z`; it refuses to replace a
   stable tag that points to different content. These CI checks validate the
   release images, but do not replace deployment-host acceptance.
4. Deploy to the target Raspberry Pi and a separate x86-64 host. Record the
   tag, commit, each image digest, migrations applied, and healthcheck results
   together. Create the GitHub Release after both host acceptance records are
   complete. Do not label or release one backend service independently while
   the platform uses this coordinated release model.
5. Roll back the platform by redeploying the previous platform tag. Database
   migrations must retain the repository's existing backup, compatibility,
   and rollback requirements.

An SDK-only release does not require a platform version bump. A platform-only
release does not require an SDK package version bump. If one change affects
both, update both version sources in the same commit and run both release
checks.

## Protocol compatibility

The Protocol is the shared SDK/backend contract, but a schema file by itself
does not prove that every implementation follows it. Keep the canonical
schemas, examples, fixtures, generated TypeScript/Rust types, and consumer tests
synchronized. For a Protocol definition change, validate the TypeScript and
Rust consumers and the relevant Collector/Processor contract tests. Preserve
the Protocol version unless the project owner explicitly requests an upgrade.

Prefer backward-compatible definition changes. If an intentional incompatible
change is proposed, document the affected SDK/backend versions and coordinated
deployment order before implementation. The version remains `1` unless an
upgrade is explicitly requested; an unchanged version number is not itself a
compatibility guarantee.

The currently deferred target-deployment Collector confirmation and
Firefox/Safari/WebKit support validation are not represented as passed by this
process. Their current status is tracked in [Project Status](project-status.md).
