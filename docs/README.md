# Traceleaf Documentation

This index groups documentation by the task readers need to complete. **Current reference** identifies authoritative guidance, **accepted decision** identifies an approved architecture choice, **active proposal** identifies work or design still under consideration, **completed record** preserves implementation or release evidence, **superseded** marks a decision replaced by a later one, and **historical** identifies archived material.

The [简体中文文档索引](README.zh-CN.md) provides the same links and lifecycle labels in Chinese.

## Understand the project

- [Project Status](project-status.md) — **current reference**; sole list of unfinished, deferred, and release-blocking work.
- [MVP Scope](mvp-scope.md) — **current reference**; frozen product scope and delivered baseline.
- [Documentation Improvement Plan](archive/documentation-improvement-plan.md) — **historical**; completed standards, inventory, and acceptance evidence.

## Start and develop locally

- [Getting Started](getting-started.md) — **current reference**; configure and run the local environment.
- [PostgreSQL Test Isolation](testing/postgres-test-isolation-plan.md) — **current reference**; integration test commands, isolation, and cleanup.
- [Protocol Contracts](../protocol/README.md) — **current reference**; machine-readable schemas, HTTP contracts, and fixtures.

## Deploy and operate

- [Linux Deployment](deployment-linux.md) — **current reference**; deploy and update on x86-64 Linux.
- [Raspberry Pi LAN Deployment](deployment-raspberry-pi.md) — **current reference**; deploy prebuilt images for LAN use on Raspberry Pi.
- [Operations Guide](operations.md) — **current reference**; database backups, migrations, and Geo database operations.
- [Ingest Key Guide](ingest-key.md) — **current reference**; create, use, and rotate ingest keys.
- [Versioning and Release Process](versioning-and-release-process.md) — **current reference**; version sources, release steps, and checks.
- [Prebuilt Image Deployment Plan](deployment-prebuilt-images-plan.md) — **completed record**; implementation and CI publication evidence for multi-architecture images. Real-host acceptance and operational gates remain in Project Status.
- [Platform v1.0.0 Release Record](platform-release-v1.0.0.md) — **completed record**; published image digests and CI/smoke evidence. Remaining deployment and release gates remain in Project Status.

## Integrate the Browser SDK and use the protocol

- [Event Protocol](event-protocol.md) — **current reference**; event semantics overview. Machine-readable contracts in `protocol/` are authoritative.
- [Browser SDK Integration Plan](browser-sdk-integration-plan.md) — **active proposal**; SDK integration, compatibility, and release evidence. Open gates remain in Project Status.
- [Browser SDK Ingestion Contract Audit](browser-sdk-ingestion-contract-audit.md) — **completed record**; contract audit evidence.
- [Dashboard Chart Design](dashboard-chart-design.md) — **active proposal**; chart design, metric semantics, implementation record, and link to non-blocking QA in Project Status.

## Review architecture decisions

- [Architecture Decision Records](decisions/) — browse the decision collection; each record states its own status.
- [ADR-021: Navigation API Observer](decisions/ADR-021-navigation-api-as-the-browser-observer.md) — **superseded** by ADR-022.
- [ADR-022: Navigation API-Only Browser SDK](decisions/ADR-022-navigation-api-only-browser-sdk.md) — **accepted decision**; generic browser observer boundary.
- [ADR-023: Protocol Version Upgrades Require Explicit Approval](decisions/ADR-023-protocol-version-upgrades-require-explicit-approval.md) — **accepted decision**; protocol version changes require explicit approval.
- [ADR-024: Simplified SDK and Platform Releases](decisions/ADR-024-simplified-sdk-and-platform-releases.md) — **accepted decision**; its initial version baseline is superseded by ADR-025.
- [ADR-025: Project Version Baseline 1.0.0](decisions/ADR-025-project-version-baseline-1.0.0.md) — **accepted decision**; current project version baseline.
- [ADR-026: Multi-Architecture Container Releases](decisions/ADR-026-multi-architecture-container-releases.md) — **accepted decision**; x86-64 Linux and 64-bit ARM image release approach.

## Review active proposals and completed design records

- [Static Product Site Plan](static-product-site-plan.md) — **active proposal**; independent developer-facing product site.
- [Website Preview and Dashboard Alignment](website-dashboard-preview-alignment-plan.md) — **completed record**; implementation and acceptance evidence.
- [Traceleaf Brand Unification](traceleaf-brand-unification-plan.md) — **completed record**; logo integration and terminology evidence.

## Browse historical records

- [Development Archive](archive/README.md) — **historical**; completed phase, design, and acceptance records.
- [Code Refactoring Archive](archive/refactoring/README.md) — **historical**; closed refactoring work and acceptance evidence.
