# ADR-018: Stored Capability Date-Time Compatibility

- Status: Accepted
- Date: 2026-09-29
- Related: [ADR-017](ADR-017-policy-date-time-compatibility.md), [M2 checklist](../m2-implementation-checklist.md), [M2.4 parity assessment](../m2.4-configuration-parity.md)

## Context

The Stored Site Capabilities Schema declares `updated_at` as `format: date-time`. The database stores this value in a `TIMESTAMPTZ` column and verifies it with the shared database timestamp predicate, while the runtime JSON Schema validator currently does not assert formats. Existing storage has not been audited across all deployment databases for strict JSON Schema compatibility.

## Decision

Treat Stored Site Capabilities `updated_at` as requiring JSON Schema `date-time` validation, consistent with the stored Environment Policy decision in ADR-017. Before enabling strict format assertions in production, run the read-only M2 preflight against `site_capability_configurations` in every deployment database, alongside the policy table checks. Record target identifier, date, aggregate result/counts and remediation status; do not record credentials or timestamp values. Repair any invalid rows through the supported configuration write path.

Until every deployment has evidence, keep production validators' current format behavior. An invalid capability document continues through existing failure handling (the capability refresh must not replace the last good snapshot). This ADR does not change Schema, wire format, HTTP errors, or database constraints.

## Consequences

- The strict candidate fixture is `protocol/contracts/configuration/current/fixtures/capabilities/invalid/invalid-updated-at-date-time.json`.
- M2.4's format tests distinguish strict Schema rejection from current production behavior.
- Deployment preflight implementation must inspect both policy timestamps and capability `updated_at` before strict assertions are enabled.
- This ADR chooses the contract; it does not certify that stored data in any deployment is clean.
