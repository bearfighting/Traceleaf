# Configuration Contract

This directory defines the Phase 8 protected configuration and versioned site definition-set contracts. Runtime persistence lives in PostgreSQL.

- capabilities.schema.json and environment-policy.schema.json describe
  stored configuration documents.
- capability-update.schema.json and environment-policy-update.schema.json
  describe client mutation bodies; environment policies may temporarily have no
  active keys while still rejecting ingestion.
- audit-event.schema.json permits only redacted change metadata.
- openapi.json freezes the protected admin API routes and wire behavior,
  including `POST` with `If-None-Match: *` to create a new policy or initial definition set, and `PUT` with `If-Match` to append an immutable definition revision.
- fixtures/, api-mutation-cases.json and scripts/validate-configuration-contract.mjs verify schema,
  migration defaults, dependencies, scope, auth, version conflicts, key
  display and audit redaction.

The canonical capability contract remains in
protocol/capabilities/capabilities.json. User configuration cannot change
that manifest.

- `conversion-funnel-definition-set-update.schema.json` validates complete site-level definition-set updates. Existing IDs are retained across revisions and deactivation is represented by `active: false`.
