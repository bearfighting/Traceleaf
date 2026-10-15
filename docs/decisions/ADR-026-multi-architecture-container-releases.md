# ADR-026: Publish multi-architecture platform container images

- Status: Accepted
- Date: 2026-10-15

## Context

The current Raspberry Pi 4B deployment builds the Rust services and Dashboard
on the deployment host. The long-term primary target is x86-64 Linux; 64-bit
ARM remains a supported deployment target and is used for current Pi
validation. Building the application on each deployment host adds toolchain,
time, and reproducibility requirements.

The platform is released as one coordinated version under a single Git tag
`vX.Y.Z`. Services share a database schema and must be deployed as one
compatible release. The detailed implementation plan is
[Prebuilt Container Image Deployment](../deployment-prebuilt-images-plan.md).

## Decision

1. Publish Collector, Processor, Analytics API, DB tools, and Dashboard to
   private GitHub Container Registry (GHCR) packages as one platform release.
2. The initial supported deployment platforms are `linux/amd64` and
   `linux/arm64`. Linux x86-64 is the primary target; 64-bit ARM is supported
   for Raspberry Pi validation. These platforms describe current image builds,
   not a permanent limit on the web application or its architecture-neutral
   code. Add other deployment-compatible platforms to published manifests and
   release validation when needed; do not claim support until they build and
   pass runtime checks.
3. Build images only from a platform `vX.Y.Z` Git tag, after the existing full
   validation succeeds. The Git tag already exists when its workflow starts.
   Push run-specific candidate image tags, then run native AMD64 and ARM64
   Compose smoke checks. Only after both succeed, add the `sha-<commit>` and
   `vX.Y.Z` GHCR image tags from the same manifest. Create the GitHub Release
   after all release jobs succeed.
4. Use the GHCR `vX.Y.Z` image tags for deployment and rollback. Record the
   resolved per-image digests with deployment results for audit and diagnosis.
   The publishing workflow must reject replacing an existing release tag with
   different image content; repeated release jobs may skip an existing tag
   only when its manifest digest matches. GHCR tags are not treated as
   registry-enforced immutable references.
5. Keep image packages private. Grant the publishing workflow only the
   required package write permission; deployment hosts use read-only package
   credentials stored by Docker's credential store/helper.
6. Keep secrets, PostgreSQL data, and GeoIP MMDB files outside application
   images. Keep migration execution in the deployment Compose workflow, and
   require migrations to remain compatible with the immediately preceding
   platform release. Use staged expand/contract changes when compatibility
   requires multiple releases.
7. Do not automate remote deployment or expose a remote Docker API. Operators
   pull and start the selected platform version on the deployment host.

## Consequences

- The Raspberry Pi and x86-64 Linux hosts use the same image names, version
  tags, and Compose service definitions; the container runtime selects the
  architecture variant. New OS/architecture targets can be added to the
  manifest and validation matrix without adding architecture-specific product
  code.
- Release validation gains native runner and Compose smoke-check jobs for both
  supported architectures. Use `ubuntu-24.04` and `ubuntu-24.04-arm` when
  available to the repository; otherwise maintain equivalent native runners.
  These jobs may add cost and time to a platform release.
- Failed release jobs are resumed by rerunning failed jobs against the existing
  candidate manifest. Rebuilding the same commit must not overwrite stable
  GHCR tags.
- Deployments need Docker Engine, Compose, the deployment files, external
  GeoIP data, and private GHCR read credentials; they no longer need the
  project source tree or language toolchains. Pi-specific operations remain
  in the Raspberry Pi guide; a generic x86-64 Linux deployment guide is added
  when the pull-only Compose workflow is implemented.
- Application image rollback does not roll back PostgreSQL migrations.
  Backups and migration compatibility remain part of the release procedure.
