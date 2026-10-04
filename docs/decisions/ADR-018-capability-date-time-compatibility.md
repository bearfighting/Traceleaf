# ADR-018: Stored Capability Date-Time Compatibility

- Status: Accepted
- Date: 2026-09-29
- Related: [ADR-017](ADR-017-policy-date-time-compatibility.md), [M2 checklist](../archive/development/m2-implementation-checklist.md), [M2.4 parity assessment](../archive/development/m2.4-configuration-parity.md)

## Context

The Stored Site Capabilities Schema declares `updated_at` as `format: date-time`. The database stores this value in a `TIMESTAMPTZ` column and verifies it with the shared database timestamp predicate, while the runtime JSON Schema validator did not assert formats at decision time. The current local-development database passed the date-time preflight on 2026-09-30 before strict format validation was enabled.

## Decision

Treat Stored Site Capabilities `updated_at` as requiring JSON Schema `date-time` validation, consistent with the stored Environment Policy decision in ADR-017. Before enabling strict assertions, the local-development audit passed on 2026-09-30. Before any future deployment with existing data, run the read-only M2 preflight against `site_capability_configurations` in every deployment database, alongside the policy table checks. Record target identifier, date, aggregate result/counts and remediation status; do not record credentials or timestamp values. Repair any invalid rows through the supported configuration write path.

Strict format assertions are enabled for the current implementation. An invalid capability document continues through existing failure handling (the capability refresh must not replace the last good snapshot). This ADR does not change Schema, wire format, HTTP errors, or database constraints.

## Consequences

- The strict candidate fixture is `protocol/contracts/configuration/current/fixtures/capabilities/invalid/invalid-updated-at-date-time.json`.
- M2.4's format tests assert that production stored-document consumers reject malformed date-time values.
- The preflight inspects both policy timestamps and capability `updated_at` before strict assertions are enabled in a new environment.
- This ADR records the current local-development audit result; it does not certify future environments before their own pre-rollout audit.
