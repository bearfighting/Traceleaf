# Site Management Persistence Contract

This document freezes the additive PostgreSQL contract for M5.1. M5.2/M5.3 implement it through migrations and Site Management repositories.

New Site IDs are `site_` followed by a 26-character Crockford Base32 ULID. The first encoded character is limited to `0` through `7`, as required by the 128-bit ULID value. Historical IDs imported into `site_registry` retain their existing protocol-valid IDs and remain valid in Site audit records.

## Site versioning

- Add `site_registry.version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1)`.
- New Sites start at version 1. A successful metadata change, archive, or restore increments it exactly once and updates `updated_at` in the same statement/transaction.
- A no-op metadata update and an already-satisfied lifecycle transition return `200` with the current Site; they do not create audit rows or increment the version.
- Existing Registry rows receive version 1. The HTTP ETag is the quoted decimal version, for example `"1"`.

## Creation idempotency

Add `site_creation_requests` with these logical columns and constraints:

| Column            | Contract                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `idempotency_key` | `VARCHAR(128)`, visible ASCII, primary key within this single deployment                    |
| `request_digest`  | `CHAR(64)`, lowercase SHA-256 hex of RFC 8785 canonical JSON                                |
| `site_id`         | `VARCHAR(64)`, unique, `NOT NULL`, FK to `site_registry(site_id)` with `ON DELETE RESTRICT` |
| `created_at`      | `TIMESTAMPTZ NOT NULL DEFAULT NOW()`                                                        |

Insert the Registry row, all initial configuration, the Ingest Key digest/ID, this association and the creation audit in one transaction. The unique idempotency key serializes concurrent submissions: after a uniqueness conflict, compare the committed digest and return metadata replay or `409 site_idempotency_conflict`. A different request must never overwrite the original association. Do not set an expiry, cascade-delete, or provide a normal API to remove these records; retain them for the Site lifetime, including archive. Site IDs are never reused.

Normalize the request before hashing: trim `display_name` and normalize it to Unicode NFC, rejecting an empty result; parse `website_url` as an HTTP(S) URL without username/password, serialize it using WHATWG URL serialization with the fragment removed; parse each `allowed_origins` value and serialize its origin, reject duplicate canonical Origins, then sort them; expand `capabilities` to every manifest capability with `page_views: true` and omitted optional capabilities set to `false`. Require the Website URL origin to appear in `allowed_origins`. The hashed object contains exactly `display_name`, `website_url`, `environment`, the full `capabilities` map, and sorted `allowed_origins`. The `Idempotency-Key`, Site/key IDs, plaintext key, digests, timestamps, and server defaults are excluded. The key digest is SHA-256 of the generated Ingest Key; plaintext is never persisted or logged.

## Site audit

Add an append-only `site_management_audit` table using the fields in `site-management-audit-event.schema.json`, with an identity primary key and an index on `(site_id, created_at)`. Store creation, metadata update, archive and restore records in the same transaction as their corresponding Site mutation. Keep these rows for the Site lifetime without expiry; `ON DELETE RESTRICT` and the no-physical-delete policy preserve them. `changed_fields` contains only metadata field names; never store request bodies, Idempotency-Key values, Ingest Key plaintext or digests.

The existing `configuration_audit` remains responsible for capability, environment policy, key and definition changes under its current one-year retention contract.

## Atomicity and runtime behavior

- Creation's transaction includes Registry, capabilities, activation windows, first environment policy, key ID/digest, idempotency association and audit.
- The first environment policy is created with `enabled = true` and `rate_limit_per_minute = 600`; the generated Ingest Key is active in that policy. These defaults are fixed by Site Management, not request fields.
- Any failure rolls back every row. No successful response is sent before commit.
- Archive changes only Registry lifecycle/version/audit. Collector rejects ingestion for archived Sites; policies, keys, events, definitions and aggregates remain intact.
- Restore changes only Registry lifecycle/version/audit. It does not enable or otherwise alter environment policies.
- Existing Sites keep their current configuration and use version 1 as their initial Site metadata version.
- `setup_status` is `ready` only when name and URL exist, Page Views are enabled, and one environment policy is enabled with at least one Allowed Origin and one active Ingest Key. Otherwise return `needs_attention` with `missing_requirements` containing the missing metadata/baseline fields and/or `environment_ingest_configuration`.
