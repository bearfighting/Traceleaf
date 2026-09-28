# ADR-011: Geo Country Lookup and IP Privacy Boundary

- Status: Accepted
- Date: 2026-09-24

## Context

Phase 7 Geo PR1 needs country-level Page View reporting while keeping raw IP addresses out of analytics storage. Collector currently accepts browser events and persists the validated event payload. Geo lookup therefore has to use connection metadata transiently and attach only a low-precision result to the stored event.

## Decision

1. Geo PR1 supports country only, using an operator-supplied local MaxMind GeoLite2 Country or DB-IP City Lite MMDB. Collector does not download or call an external lookup service; DB-IP City Lite is read only for `country.iso_code`.
2. `GEOIP_DATABASE_PATH` is mandatory for the Collector backend profile and defaults to `/workspace/data/GeoLite2-Country.mmdb`. Startup fails if the database cannot be opened or its MMDB type is unsupported. Collector detects the provider from the database type; the operator updates the read-only mounted file offline and restarts Collector.
3. Collector uses the TCP peer address by default. It reads `X-Forwarded-For` only when that peer matches an explicitly configured `GEOIP_TRUSTED_PROXIES` CIDR. It walks the chain from right to left, skipping trusted proxies, and uses the first non-trusted address. If the forwarding chain is missing, malformed, or contains only trusted proxies, the client address is unresolved and maps to `unknown`.
4. IP addresses are used only for in-memory lookup. They are not placed in event payloads, database columns, or application logs. Missing, private, unmapped, or malformed client addresses resolve to `unknown`.
5. A Page View's enrichment metadata stores ISO 3166-1 alpha-2 country code (or `unknown`), provider, MMDB database type/build release, and parser version. The Processor derives idempotent `geo_country_facts` from that metadata. Rebuilds reuse the saved country result and do not retain an IP for re-resolution.
6. The Analytics API groups Page Views by country code, includes `unknown`, and remains site/date-range scoped. Region/city is deferred until separate data-quality, privacy, and deployment evaluation.

## Consequences

- Offline deployments work when the operator mounts the licensed database file; no IP leaves the Collector.
- Updating the MMDB affects newly ingested Page Views. Historical country values are reproducible from stored enrichment metadata but cannot be re-resolved with a newer dataset because raw IPs are intentionally discarded.
- Unknown counts make lookup coverage observable in the country report. Geo PR2 requires an explicit retention and re-resolution decision.

## Provider attribution and offline operations

MaxMind GeoLite2 use requires attribution and current data under the [GeoLite EULA](https://www.maxmind.com/en/geolite/eula). Product documentation or an About/credits page must credit **MaxMind, available from [https://www.maxmind.com](https://www.maxmind.com)**; superseded databases must be destroyed within 30 days. DB-IP City Lite is distributed under [CC BY 4.0](https://db-ip.com/db/download/ip-to-city-lite), and the Dashboard Geo report links to DB-IP whenever its selected range includes DB-IP results. Operators obtain datasets offline and verify the published checksum and MMDB type/build epoch. Before production use, validate the dataset in staging, atomically replace the mounted file and restart Collector. Country Geo staging and update/rollback evaluation is a post-launch operational task, not an MVP exit condition. Runtime downloading remains disabled; the procedure is in [Getting Started](../getting-started.md#offline-geo-database-update).

## PR1 acceptance and deployment evaluation (2026-09-24)

- **Deterministic CI dataset:** MaxMind-DB synthetic `GeoLite2-Country-Test.mmdb`, upstream revision `0eef25a46e20f4e96d27b951d0228efabe21323f`, build metadata captured by the Collector as `GeoLite2-Country-1770245369`; SHA-256 `6996ce679243c7f719b901ebe3b490048af2fb5965163f083857533841154fd8`. The synthetic known record resolves `2.125.160.217` to GB; `192.0.2.1` has no mapping. These are test addresses only.
- **Operator-supplied dataset (local development smoke):** DB-IP City Lite; MMDB type `DBIP-City-Lite`, build epoch `1788226681`, dataset version `DBIP-City-Lite-1788226681`, SHA-256 `05a10861259c7966cb54d7181ef8c360de8c8829d182098c0e62a9b7d54cd50d`. The local SHA-1 (`6ea870a637b5460023643fc18fdea84dcea14b9c`) and MD5 (`8a0a03f5b9098ba9f2e28f920473d6c1`) match DB-IP's published September 2026 MMDB checksums; the build epoch is 2026-09-01 01:38:01 UTC. Staging deployment/update/rollback has not been run.
- **DB-IP parser smoke:** after enabling DB-IP type detection, the local MMDB resolves the controlled lookup address `8.8.8.8` to US and the documentation-only address `192.0.2.1` to `unknown`. This two-address parser smoke is not a traffic coverage estimate. **Country coverage / unknown share on real traffic:** not measured; requires staging aggregate counts.
- **Privacy verification:** deterministic E2E checks assert test IPs do not occur in raw payloads, Collector/Analytics API logs, or Processor output and Geo metadata stores only country/provider/dataset/parser data. A deployment log and storage review remains required after staging.
- **Decision:** Geo PR2 (region/city) remains deferred. Reassess only after a representative staging period records country resolution coverage and unknown share, operators demonstrate authorized offline update/rollback and 30-day deletion, and privacy review confirms no raw IP retention or log leakage. Any region/city proposal must separately assess added precision, retention, access, and user-facing value.
