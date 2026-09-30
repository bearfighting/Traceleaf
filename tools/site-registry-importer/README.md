# Site Registry Importer

This CLI reconciles Site IDs from an explicitly selected PostgreSQL database and explicitly supplied legacy inputs. It is read-only by default. It does not load `.env` or Compose files.

## Inputs

`DATABASE_URL` must point to the intended target. For every static source, supply its value/path or its matching `--*-not-configured` flag:

- `--dashboard-sites` and `--dashboard-default-site`
- `--collector-config PATH`
- `--definitions-file PATH`
- `--dev-seed-site-id` and `--dev-seed-origins`

Examples of absent-source flags are `--collector-not-configured` and `--definitions-not-configured`. A configured but unreadable or invalid source is an error. Collector TOML contributes Site IDs, environment names, and Allowed Origins as local comparison clues only; `ingest_keys` values are discarded during deserialization and never enter the report. Policy coverage reads only the digest count, never the digest values.

Every run requires `--report /absolute/path/outside/the/repository/report.json`; the destination must not already exist. The importer creates it exclusively, rejects links and existing files, and updates the same open file after apply. The local report contains per-source row/distinct-ID counts, candidate IDs and source overlap, policy/environment coverage with enabled and non-secret counts, local Origin comparison evidence/conflicts, existing Registry metadata, missing name/URL status and IDs requiring review. It is local evidence and must not be committed. The stdout summary contains counts only.

## Review and apply

Run first without `--apply`. Candidates with test/fixture-like IDs, conflicting metadata, or no database identity source are marked `requires_disposition`. Create a local JSON file with one entry for each such ID:

```json
[
  {"site_id":"sample_fixture_site","action":"approve","reason":"confirmed retained Site identity"},
  {"site_id":"stale_static_site","action":"exclude","reason":"confirmed obsolete static entry"}
]
```

Persisted database identities cannot be excluded; approve them as Sites. Static-only candidates may be excluded after review. Missing metadata is allowed and remains null; Allowed Origins are included only as local comparison clues, never as Website URLs. Unresolved Origin or metadata conflicts block apply. Current static sources do not supply authoritative Site names or canonical URLs, so the importer writes identities only and never overwrites existing Registry metadata.

Apply is explicit and idempotent:

```sh
DATABASE_URL='postgres://…' cargo run -p site-registry-importer -- \
  --report /tmp/site-registry-import.json \
  --dashboard-sites 'site_alpha,site_beta' --dashboard-default-site site_alpha \
  --collector-config ./collector.toml --definitions-file ./definitions.json \
  --dev-seed-site-id site_alpha --dev-seed-origins https://site.example --dispositions-file /tmp/site-dispositions.json \
  --apply
```

For an absent input, replace its path/value with the corresponding `--*-not-configured` flag; dev-seed Site ID and origins have separate status flags. The dev-seed origin input is associated with the development environment. Apply acquires a transaction-scoped advisory lock and inserts missing Registry IDs only. It does not import policies or keys, mutate source tables, or add foreign keys.

## Safety

- Run target-specific dry-run before every apply. For this M3.3 implementation validation, apply only to a disposable PostgreSQL database.
- Do not pass ingest keys as CLI options. Never include secrets in disposition reasons.
- The detailed report path is rejected if it resolves inside the repository. It must be a new file; existing files, symlinks, and hard links are never overwritten.
- The importer requires the M3.2 `site_registry` schema and all inventoried source tables; it does not run migrations.
