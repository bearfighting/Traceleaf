# Platform v1.0.0 Image Release Record

## CI and promotion

- Platform tag: `v1.0.0`
- Release commit: `0d2e1d022853321932b57d8165109aa0aff18968`
- Workflow: [CI run 38795931479](https://github.com/bearfighting/Traceleaf/actions/runs/38795931479)
- Result: full validation, candidate publication, native `linux/amd64` and `linux/arm64` isolated deployment smoke, and stable-tag promotion all succeeded.
- Stable tags: `v1.0.0` and `sha-0d2e1d022853321932b57d8165109aa0aff18968`

## Promoted GHCR manifest digests

Each manifest index was inspected after promotion and contains both `linux/amd64` and `linux/arm64`.

| Image                                          | `v1.0.0` manifest digest                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `ghcr.io/bearfighting/traceleaf-collector`     | `sha256:23f9fedfaf20f34cbf947c28f5c6c7f58691218ebc28662a4f68972d7c6bf80a` |
| `ghcr.io/bearfighting/traceleaf-processor`     | `sha256:e01fabfe038f3870e9cc70d960ffe00eefae6cdc66ad19ee482b0691b6335fcd` |
| `ghcr.io/bearfighting/traceleaf-analytics-api` | `sha256:f4c134d0f6ee9937def6391e05fa2194fbc77601fad8de5d254c92a10e7d29bb` |
| `ghcr.io/bearfighting/traceleaf-db-tools`      | `sha256:8290a14f6c3dda0c5825f3e40417b1530ea63470ee85a188d1077f3fc92a4694` |
| `ghcr.io/bearfighting/traceleaf-dashboard`     | `sha256:469729734d8c13008b89c308c19ff755d206dd58f3691776c4e71fafd4cd193a` |

## Isolated deployment smoke results

Both native runners pulled and started the candidate images successfully. The smoke script verified the expected image architecture, successful database migration, healthy PostgreSQL, Collector, Analytics API and Dashboard, a running Processor without startup errors, and the audit-purger command. The smoke Compose projects and PostgreSQL volumes were removed after each run.

This validates the images and Compose startup in isolated CI environments. It does not certify a real Raspberry Pi or x86-64 deployment, the target database's migration compatibility, backup restoration, LAN firewall configuration, or production operations.

## Remaining release gates

- Deploy `v1.0.0` to the Raspberry Pi and a separate x86-64 host using pull and `up -d`; record host architecture, resolved image digests, migration result, service health, and logs.
- Back up the target PostgreSQL database and verify a restore before treating the deployment as accepted.
- Create the platform GitHub Release only after both real-host acceptance records are complete.
