# M4 Runtime Configuration Authority Checklist

- Status: M4.1–M4.4 implementation complete for the local development target; M4.5 compatibility acceptance and other-target rollout remain open
- Prerequisites: M3 local-development target complete; ADR-014 accepted
- Related: [M4.2 Local Policy Reconciliation](m4.2-local-policy-reconciliation-plan.md), [Platform improvement roadmap](platform-improvement-roadmap.md), [M3 Site Registry checklist](m3-site-registry-checklist.md), [ADR-014](decisions/ADR-014-runtime-configuration-authority.md), [Site Onboarding and Settings Design](site-onboarding-settings-design.md)

## Goal and scope

Make PostgreSQL Site Management data the only runtime authority for Site identity, capabilities, environment policies, Origins, Ingest Key digests and definition revisions. Retire implicit Collector TOML Site-policy fallback and restrict definitions-file import to an explicit legacy migration operation. Keep infrastructure TOML/environment configuration, historical analytics, audit records and valid last-known-good behavior during temporary database outages.

M4 does not implement Site list/create APIs or onboarding UI (M5/M6), change historical analytics semantics, or remove the explicit local development seed flow (M6). It does not treat a deployment's M3 inventory as evidence for another target.

## Frozen behavior

- A DB policy that is present, enabled and valid is applied from PostgreSQL.
- A DB policy that is explicitly disabled, belongs to an archived Site, or is explicitly absent fails closed for new ingestion. TOML must never restore the Site or an old Ingest Key.
- A temporary DB read failure is distinct from an absent DB policy. A valid last-known-good snapshot may continue to operate only as a reported stale state; no TOML merge or fallback is allowed.
- Existing raw events, derived facts, definition revisions, key digests and audit records remain intact. Historical Analytics queries continue to work, including for Registry-only Sites without capabilities under ADR-019.
- `ANALYTICS_DEFINITIONS_FILE` is read only by an explicit legacy migration command. Regular Processor startup and processing do not import or overwrite revisions from it.
- Dashboard site-list variables and development seed inputs are migration/development evidence, not runtime Site authority. M6 owns the default-empty development experience and explicit seed entry point.
- Never print or persist plaintext Ingest Keys, their digests, or credential-bearing database URLs in reports, logs, fixtures or committed files.

## M4.1 — Target inventory and recovery plan

- [x] Select one concrete deployment target and record its non-secret identity (environment, database name/host alias, service versions).
- [x] Take and verify a target-specific backup; document restore/forward-recovery steps and an owner for the cutover.
- [x] Capture read-only counts and Site/environment mappings for Registry, policies, capabilities, activation windows, key digest counts, Origins, definitions/revisions, audit, and relevant runtime state.
- [x] Inventory that target's Collector TOML Site/environment entries, Dashboard Site-list variables, dev-seed inputs and definitions-file configuration without exposing secrets.
- [x] Compare sources by Site and environment; identify missing/extra policies, enabled state, Origins, rate limits, key-presence/count evidence and definitions revisions.
- [x] Record an explicit disposition for every static-only or mismatched entry. Never infer Website URL from Origin or infer an unknown plaintext key from a digest.
- [x] Resolve or explicitly exclude the local `site_example/production` TOML entry and TOML-only `site_disabled` example before local cutover; do not assume this resolves other targets.
- [x] Review the prior local seed/database Origin reconciliation and confirm that each selected target's DB values are the intended values.

**Exit:** a reviewed, secret-free reconciliation report shows the intended DB state for every retained Site/environment; all removals/exclusions and key rotation needs have an explicit owner decision; backup restoration is verified.

#### Local development execution snapshot (2026-10-01)

- Target: `web-analytics-platform-postgres-1`, database `analytics`, PostgreSQL 18.6, latest successful migration at inventory time `20261001001900`. Collector, Processor, Analytics API and Dashboard containers were stopped during the snapshot. PostgreSQL was started for inventory and closeout verification and returned to its original stopped state afterward.
- Non-secret Compose service image inventory (image IDs captured from this target's containers during closeout; application versions are represented by these immutable local image IDs):

  | Service            | Image reference                          | Image ID                                                                  |
  | ------------------ | ---------------------------------------- | ------------------------------------------------------------------------- |
  | PostgreSQL         | `postgres:18.6-alpine3.23`               | `sha256:885cf05d376c7cf27afef02073e6bdac3841252537f16e244fd1c1e6a7c99fb1` |
  | Collector          | `web-analytics-platform-collector`       | `sha256:dc017e9cad235c094e306b874b6cb34d58180017db4fa5fa3094267b37f8f738` |
  | Processor          | `web-analytics-platform-processor`       | `sha256:60093a4716c41226754b77e11b2fb43d822167a87296284619195c9e9e3bc8da` |
  | Analytics API      | `web-analytics-platform-analytics-api`   | `sha256:96558ffb786ee520a5458196cca3ac2672c8325f2bc23023eb89ecafaf0db66e` |
  | Dashboard          | `web-analytics-platform-dashboard`       | `sha256:ff138bcd55a2b98136d10e070828f6eef4acbfe93e2b1789451ec77e382dcc82` |
  | Next.js Playground | `web-analytics-platform-playground-next` | `sha256:fb99d3a1eb04403ea38b091d78cfce4731471d323ce4ff578b5a766a14f3b851` |
  | Development seed   | `web-analytics-platform-dev-seed`        | `sha256:1755e119b976dec0a565da101439bd544f576e2f275cc1e203b481da3533d523` |
  | DB migrator        | `web-analytics-platform-db-migrate`      | `sha256:fd8042e6c10401f1718d3d0e51d39cad8da938b7bd1089d84f21fbb06fcd57ff` |
  | Audit purger       | `web-analytics-platform-db-audit-purger` | `sha256:3e21ba2004738bfb18b93cdbb8b4bafd98feaa0eb4d45dce0d1a6c869313a4ef` |

- Secret-safe baseline: `/tmp/m41-local-db-baseline.txt`; row-count comparison: `/tmp/m41-target-counts.txt` and `/tmp/m41-restored-counts.txt`; summary: `/tmp/m41-local-summary-20261001.txt`. These owner-only files are outside version control and mode `0600`.
- Registry has 9 active Sites, all with missing display name and Website URL. There is one policy (`site_example/development`, version 2, enabled, 600/minute, three localhost Origins, one stored key digest), seven capability documents, 69 activation windows, no stored definition revisions, and seven audit rows (none expired). All 29 tables with a `site_id` column and the secret-safe policy/definition/audit counts matched after isolated restore.
- Effective Compose resolves Collector TOML to the example file, Dashboard and development seed to `site_example`, and the Playground Site ID to `site_example`. The development Origin list agrees across DB, seed and TOML. Secret-safe comparison verified both configured local key values against their DB digests; only boolean results were retained.
- The definitions file is configured at `config/analytics-definitions.json`, version `2026-09-23.1`, and contains `site_playground` with one Conversion and one Funnel. Its explicit disposition is to import it for `site_playground` as legacy data. The import created revision 1 and its audit record; a second invocation imported zero rows. This is a data import only and does not switch Playground runtime Site configuration.
- Local policy disposition: retain `site_example/development`; exclude the example `site_example/production` policy and disabled `site_disabled/production` policy from migration. Both are example placeholders in Collector TOML and neither has a DB policy. Keep the entries as cutover evidence until the M4.4 approved removal from active Site policy configuration. This disposition covers only the local development target.
- Fresh pre-change and post-change custom-format backups are `/tmp/m41-before-finalize-20261001.dump` and `/tmp/m41-after-finalize-20261001.dump` (mode `0600`). The pre-change archive predates the restore-safety migration, so it was verified with staged recovery in an isolated, network-disabled PostgreSQL 18.6 instance: restore `pre-data`, apply `20261001002000_pin_policy_validator_search_path.sql`, restore `data`, restore `post-data`, then run the normal db-migrator so SQLx records the migration. All stages succeeded; the restored policy count was 1, its validator had `search_path=pg_catalog, public`, and db-migrator recorded version `20261001002000` with the expected checksum. The post-change archive was verified separately with a normal full `pg_restore` and no manual alteration. The migration was also applied to the local target and an empty verification database; migration history/checksum and validator configuration were verified. The migration regression test passed.
- **M4.1 is complete for this local target.** The cutover owner is the requester. Secret-free verification summary: `/tmp/m41-final-20261001.txt` (mode `0600`). No TOML fallback removal or runtime authority cutover was applied. Each other deployment target still needs its own inventory, backup and disposition review.

### M4.1 closeout record

- Recovery evidence: `/tmp/m41-before-finalize-20261001.dump` requires the staged pre-data → forward migration SQL → data → post-data procedure because it predates migration `20261001002000`; this sequence and the subsequent migration-history recording were verified. `/tmp/m41-after-finalize-20261001.dump` passed a normal full restore without manual alteration. Both archives are mode `0600`.
- Verified recovery sequence for this local archive at migration version `20261001001900`, immediately before v20 (set `DATABASE_URL` to the isolated restore target and `ARCHIVE` to the protected archive path; do not put credentials in shell history or logs). Archives from other migration states need a recovery sequence matched to their schema and migration history.

  ```sh
  pg_restore --section=pre-data --no-owner --no-privileges --dbname="$DATABASE_URL" "$ARCHIVE"
  psql "$DATABASE_URL" --set=ON_ERROR_STOP=on --file=migrations/20261001002000_pin_policy_validator_search_path.sql
  pg_restore --section=data --no-owner --no-privileges --dbname="$DATABASE_URL" "$ARCHIVE"
  pg_restore --section=post-data --no-owner --no-privileges --dbname="$DATABASE_URL" "$ARCHIVE"
  DATABASE_URL="$DATABASE_URL" db-migrator
  ```

  The first four commands completed against the pre-v20 archive; the final command recorded v20 and its expected checksum. For an archive created after v20, a normal full `pg_restore` is sufficient, followed by the standard migration check.

- Definitions disposition: explicitly import `config/analytics-definitions.json` for `site_playground`; revision version `2026-09-23.1`, one Conversion, one Funnel, one audit record; rerun was idempotent.
- Key handling: configured local development seed and Playground keys each matched the corresponding stored digest. No plaintext key or digest was written to evidence.
- Policy disposition and owner: retain `site_example/development`; exclude `site_example/production` and `site_disabled/production` from the local DB migration. TOML examples remain as migration/test evidence. Requester owns rollout to any other deployment target.
- Scope boundary: M4.1–M4.4 are complete for local development. M4.5 compatibility acceptance and deployment-specific rollout remain open; other targets are not covered by this local cutover.

## M4.2 — Reconcile required runtime configuration

- [x] For every retained local environment, ensure the intended enabled/disabled state, Allowed Origins, rate limits and key-presence state are represented in the DB policy.
- [x] Secret-safe comparison confirmed configured local keys match the stored digest; no rotation is required for this target. Any later mismatch requires an explicit rotation plan through the approved secret-handling path.
- [x] Confirm no archived Site has an enabled policy that would permit new ingestion; preserve its history and audit data.
- [x] Confirm intentionally absent local policies remain absent in PostgreSQL; record current TOML fallback paths for closure in M4.4.
- [x] Determine whether policy changes are required. None were needed; any future changes must use the authenticated configuration API with audit and version/ETag checks, preserving optimistic concurrency semantics.
- [x] Re-run read-only postflight and compare policy versions, Origins, key counts, enabled state and audit evidence to the approved local state.

**Exit:** DB policies are complete for every local Site/environment intended to collect; each changed row has expected version/audit evidence; intentionally absent DB policies are recorded with any TOML fallback route deferred to M4.4; no secret material was exposed. This exit does not claim that the current Collector runtime already fails closed for missing policies.

## M4.3 — Close definitions-file migration path

- [x] Identify whether and where `ANALYTICS_DEFINITIONS_FILE` was explicitly imported; compare file Site/version mappings with stored definition revisions and audit records.
- [x] Preserve any required historical definitions in PostgreSQL; document discrepancies and resolve them before restricting the command.
- [x] Ensure the file import command is an explicitly invoked migration operation, not a normal service-start option or implicit environment-triggered behavior.
- [x] Remove definitions-file wiring from regular Processor Compose and `.env.example`; retain only the documented explicit migration path until its retirement criteria are met.
- [x] Verify revision counts, versions, stable content and audit evidence without re-importing the already migrated local data.

**Exit:** ordinary Processor startup cannot read or write definitions from the file; required revisions and audit history are present in PostgreSQL.

### M4.3 local closeout (2026-10-01)

- `ANALYTICS_DEFINITIONS_FILE` is no longer injected into the regular Processor service or advertised in `.env.example`. The Processor reads it only inside the explicit `--import-definitions-if-empty` branch; the CLI flag and default path remain for the legacy migration operation.
- The explicit Compose migration command is `docker compose --profile processing run --rm --no-deps --entrypoint cargo processor run -p processor -- --import-definitions-if-empty`. Run it only after migrations and required capability configuration; pass a custom path with a one-command `-e ANALYTICS_DEFINITIONS_FILE=/workspace/path/to/file` override. `--no-deps` avoids starting database migration or development seed dependencies, so the target database must already be ready.
- The local import recorded in the M4.1 inventory is retained: `site_playground`, definition version `2026-09-23.1`, one Conversion, one Funnel, revision 1 and one audit record. M4.3 does not rerun the import or modify that database history.
- Processor CLI integration coverage now checks ordinary `--once` processing with an invalid definitions path against complete before/after revision and audit snapshots, and checks explicit CLI import plus idempotent repeat using a temporary definitions file.
- Detailed command boundary and verification notes: [M4.3 definitions import closeout](m4.3-definitions-import-closeout.md).

## M4.4 — Remove Collector TOML policy fallback

- [x] Change runtime policy loading so Collector obtains Site policies only from PostgreSQL. Infrastructure settings remain CLI/environment configuration; the current TOML contained Site policy only.
- [x] Remove TOML Site policy wiring and the `--config` / `COLLECTOR_CONFIG` runtime entry point after local reconciliation and read-only DB postflight.
- [x] Keep temporary DB outage/last-known-good stale handling distinct from a successful refresh that finds a missing, disabled or archived policy.
- [x] Confirm refresh/recovery behavior cannot merge TOML entries back into the active snapshot.
- [x] Update configuration and operations docs to describe DB-only Site policy authority, stale state, explicit missing-policy behavior and recovery.

**Exit:** no normal Collector code path can authorize an event using a TOML Site policy; temporary DB failure follows the documented last-known-good behavior; explicit missing/disabled/archived policy fails closed.

### M4.4 local closeout (2026-10-01)

- Collector now builds authorization snapshots from valid policies joined to active Site Registry rows. A successful refresh replaces the snapshot, so deleted policies and archived Sites are removed; disabled policies remain present but deny ingestion.
- Temporary database refresh failures and invalid/conflicting policy rows retain only previously valid database policy and report stale. A first-time invalid policy or a missing Site has no snapshot and cannot authorize events.
- Collector no longer parses Site policy from TOML at startup. The `--config` and `COLLECTOR_CONFIG` runtime interfaces were removed from the binary and Compose configuration. TOML samples remain test/migration references only.
- Collector integration coverage exercises active, disabled, missing, archived, policy deletion, key rotation and outage last-good retention; archiving a Site also clears that Collector instance's applied-state row. Snapshot reconciliation unit coverage verifies invalid and conflicting updates retain prior valid policies, while first-time invalid or conflicting policies fail closed. Policy parsing/validation unit coverage rejects invalid documents; database constraints also reject malformed policy rows before Collector refresh. E2E fixtures now seed Registry and policy rows in PostgreSQL before Collector starts.
- Detailed local postflight, implementation and validation evidence: [M4.4 Local DB-only Policy Closeout](m4.4-local-db-only-policy-closeout.md).

## M4.5 — Compatibility tests, rollout and acceptance

- [ ] Add or update tests for enabled DB policy, disabled policy, archived Site, absent policy despite matching TOML, wrong/rotated key, Origin rejection, invalid DB policy, and database outage with a last-known-good snapshot.
- [ ] Add Processor tests proving normal startup/processing does not import or overwrite definitions and the explicit migration operation remains deliberate and safe.
- [ ] Verify Analytics historical overview, timeline and pages remain queryable after cutover, including Registry-only historical Sites; non-Page-View capability reports remain correctly gated.
- [ ] Verify saved/applied/stale configuration status remains observable for Collector, Processor and Analytics API.
- [ ] Run the repository's relevant unit, integration, protocol, format, type-check and build commands through the documented scripts/CI equivalents.
- [ ] Roll out to one target at a time: backup, approved reconciliation, DB postflight, deploy DB-only behavior, exercise ingestion/query scenarios, then record results before moving to another target.
- [ ] Update this checklist, the roadmap status, operational runbook and any changed ADR when implementation and target acceptance are complete.

**M4 exit:** missing DB configuration cannot be restored by TOML; Processor's ordinary lifecycle cannot import file definitions; valid retained Sites continue collecting; explicit disabled/archived/absent policy fails closed; DB outage preserves only the documented stale last-known-good behavior; historical reports and durable configuration/audit data remain intact.

## Current local handoff notes

- M3 completed the local Registry import and reference rollout, but did not switch runtime authority.
- The M3 checklist records that local `site_example/development` DB policy Origins were aligned with the three Compose development Origins and the matching Collector development TOML entry. Reconfirm current state before cutover.
- M4.2 confirmed that `site_example/production` and TOML-only disabled `site_disabled/production` have no DB policy. `site_disabled` was intentionally excluded from the M3 Registry import; neither TOML entry can authorize ingestion after M4.4.
- M4.1 has re-inventoried the local development target and recorded the dispositions above. Re-inventory before any later cutover; do not rely on this result for another target.
- M4.1 added a restore-safety forward migration; M4.4 switches the local Collector policy source to PostgreSQL. Other deployment targets still require their own reconciliation and rollout.
