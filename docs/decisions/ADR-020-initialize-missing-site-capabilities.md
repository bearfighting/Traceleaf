# ADR-020: Initialize Missing Site Capability Configuration

- Status: Accepted
- Date: 2026-10-02
- Related: ADR-013, ADR-014, ADR-019, M6 Site Onboarding

## Context

Site Registry migration can preserve a historical Site identity without a `site_capability_configurations` row. The Registry marks such a Site as needing attention, but the existing capability API only reads or replaces an existing configuration. Settings therefore cannot repair the missing state, and the Analytics runtime cannot apply capabilities for that Site.

## Decision

Add a create-only Site Management operation for capability configuration. It requires `If-None-Match: *`, initializes Page Views as enabled and all optional capabilities as disabled, writes the version-1 document, enabled-capability activation windows, and audit record atomically, and returns the normal capability response with runtime application state. Repeated or concurrent creation returns conflict and does not overwrite existing configuration.

Initialize Page Views activation from the earliest supported timestamp so existing historical Page Views remain available. Optional capabilities remain disabled until an administrator explicitly enables them in Settings.

## Consequences

- Administrators can repair a legacy Registry Site with missing capability configuration from Settings.
- Initialization does not silently enable optional analytics or change Site lifecycle, metadata, or environment policies.
- Existing capability and policy update semantics remain version-preconditioned; this operation only creates an absent resource.
- The operation is part of the versioned Site Management OpenAPI contract and must retain create-only, audit, and runtime-pending tests.
