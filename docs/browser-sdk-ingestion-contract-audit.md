# Browser SDK and Collector Ingestion Contract Audit

## Scope and conclusion

This audit records the repository's Browser SDK entry/configuration decision and compares the current HTTP ingestion fixtures, Rust Collector, and Browser SDK Fetch transport. It does not change the protocol or runtime behavior. The SDK workspace package is `@traceleaf/browser` (physical directory `packages/analytics-browser`) and remains private. Its root entry is `createBrowserAnalytics()` with only the call-required public types; callers pass `siteId`, `endpoint`, and `ingestKey` explicitly. The SDK does not read host environment variables; applications may read their own configuration and pass it in. The main request path, successful response, and batch limits align. Some fixture error details still differ from Collector responses.

## Request and success response

The ingestion endpoint is `POST /v1/events`. The body is a JSON EventBatch with top-level `schema_version: 1` and a non-empty `events` array. Each event has its own schema version and event type. EventBatch permits at most 100 events and additional top-level properties. A batch must contain events for one site. See [event-batch.schema.json](../protocol/events/schemas/event-batch.schema.json), [ingestion fixtures](../protocol/contracts/http-ingestion/current/fixtures/), and Collector validation in [events.rs](../services/collector/src/transport/http/events.rs) and [ingestion.rs](../services/collector/src/application/ingestion.rs).

Fetch sends `Content-Type: application/json` and `X-Ingest-Key`; browsers attach `Origin`. The Collector accepts `application/json` with optional media type parameters, requires an allowed Origin and matching ingest key for a site, and returns `202` with `{"accepted":N}` after the sink accepts the batch. The canonical examples are [accepted-single-event.json](../protocol/contracts/http-ingestion/current/fixtures/accepted-single-event.json) and [accepted-charset.json](../protocol/contracts/http-ingestion/current/fixtures/accepted-charset.json). Fetch treats only status `202` as success.

## CORS and Origin policy

Origin allowlists are configured per site and environment. Matching normalizes scheme and host casing and default ports; a different scheme, host, or non-default port is rejected. Missing Origin is rejected. Ingest keys are checked against the site/environment selected by the site ID and Origin. The production policy example allows `https://www.example.com`; development origins are explicit localhost entries in [collector.example.toml](../protocol/contracts/http-ingestion/current/config/collector.example.toml). See [security.rs](../services/collector/src/domain/security.rs) and [config.rs](../services/collector/src/domain/config.rs).

For a valid browser preflight, `OPTIONS /v1/events` requires an allowlisted Origin, requested method `POST`, and requested headers limited to `Content-Type` and `X-Ingest-Key`. It returns `204`, `Access-Control-Allow-Methods: POST`, those two allowed headers, `Access-Control-Max-Age: 600`, the matching `Access-Control-Allow-Origin`, and `Vary: Origin`. Preflight accepts any enabled allowlisted origin because it does not yet have a site ID or ingest key. See [preflight.rs](../services/collector/src/transport/http/preflight.rs) and [preflight-success.json](../protocol/contracts/http-ingestion/current/fixtures/preflight-success.json).

Ingestion responses vary on Origin when an Origin header is present. A recognized allowed Origin receives `Access-Control-Allow-Origin`, including on applicable errors. Disallowed Origins receive no allow-origin header. This means the browser may expose an opaque CORS failure for some rejected requests even though the Collector emitted a JSON error; Fetch can map the structured error only when the browser makes the response available to JavaScript.

## Limits and rate limiting

| Limit                  | Current behavior                                                                                                                       | Evidence                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events per EventBatch  | 1–100; over 100 is `400 invalid_event_batch`                                                                                           | [event-batch schema](../protocol/events/schemas/event-batch.schema.json), [oversized-batch fixture](../protocol/contracts/http-ingestion/current/fixtures/oversized-batch.json)         |
| Collector request body | Up to and including 65,536 bytes; larger bodies are `413 payload_too_large`                                                            | `MAX_BODY_SIZE` in [events.rs](../services/collector/src/transport/http/events.rs), [oversized-body fixture](../protocol/contracts/http-ingestion/current/fixtures/oversized-body.json) |
| Default rate limit     | 600 requests per minute, per `(site_id, normalized Origin)` fixed wall-clock minute window; request 601 is rejected                    | [rate_limit.rs](../services/collector/src/application/rate_limit.rs), [rate-limited fixture](../protocol/contracts/http-ingestion/current/fixtures/rate-limited.json)                   |
| Fetch request body     | Splits ordered events into requests no larger than 65,536 bytes or 100 events                                                          | `MAX_REQUEST_BODY_BYTES`, `MAX_EVENTS_PER_REQUEST`, and `splitEventBatches` in [fetch-transport.ts](../packages/transport/src/fetch-transport.ts)                                       |
| Fetch keepalive body   | Sends one ordered batch only when it is at most 60,000 bytes and 100 events; rejects the entire batch if it requires multiple requests | `MAX_KEEPALIVE_BODY_BYTES` and `splitEventBatches` in [fetch-transport.ts](../packages/transport/src/fetch-transport.ts)                                                                |

The Collector's configured per-site rate limit can override the default; absent configuration defaults to 600. The limiter counts requests, not events or bytes. It uses a fixed minute boundary rather than a rolling 60-second interval. On rejection it emits `429 rate_limited` and `Retry-After: 60`.

## Error responses and Fetch mapping

Collector JSON errors have the shape `{"error":{"code":"…","message":"…"}}`. Current fixture statuses cover:

| Status | Typical codes                                                   |
| ------ | --------------------------------------------------------------- |
| `400`  | `invalid_json`, `invalid_event_batch`, `invalid_occurred_at`    |
| `401`  | `invalid_ingest_key`                                            |
| `403`  | `origin_not_allowed`, `site_not_allowed`, `capability_disabled` |
| `413`  | `payload_too_large`                                             |
| `415`  | `unsupported_media_type`                                        |
| `429`  | `rate_limited` with `Retry-After: 60`                           |
| `500`  | `collector_error`                                               |
| `503`  | `configuration_unavailable`                                     |

Health is `GET /health` and returns `200 {"status":"ok"}`; it is outside the Fetch transport endpoint. Fetch parses the JSON error body when possible. A string code yields `FetchTransportError` kind `collector`, with status, code, message, and the raw `Retry-After` header. Non-JSON or unrecognized error bodies produce kind `http` and a fallback HTTP message. Thrown Fetch failures produce kind `network`. The transport does not retry. Its tests cover canonical accepted, charset, invalid-key and rate-limit fixtures plus generic error mapping; see [fetch-transport.test.ts](../packages/transport/src/fetch-transport.test.ts) and [errors.ts](../packages/transport/src/errors.ts).

## Findings and recommended follow-up

1. **Batch limits align.** Fetch splits regular batches while preserving order, enforcing both Collector's 100-event cap and 65,536-byte request limit. Keepalive uses a 60,000-byte ceiling and rejects the whole batch if it would need multiple requests, avoiding partial delivery. Tests cover event-count and byte splitting, keepalive limits, and ordering.
2. **Some fixture error bodies do not match Collector error bodies.** `invalid-json.json` expects “Request body is not valid JSON”, while `ApiError::invalid_json` emits “Request body must be valid JSON”. `mixed-site-ids.json` expects a specific message, while the current conflict path maps to the generic “Event batch validation failed”. `invalid-occurred-at.json` expects code `invalid_event_batch`, while the Collector maps timestamp range failures to `invalid_occurred_at`. This remains a contract fixture follow-up.
3. **Fixture coverage is broader than Fetch integration coverage.** HTTP fixtures include Origin and preflight failures, payload size, and batch cardinality. The Fetch unit tests cover request shape, successful response, error mapping, network failure, and keepalive/batch limits. Preflight itself is browser-managed and is not directly issued by this transport.

## Evidence and validation

Primary evidence is the current HTTP fixture set under `protocol/contracts/http-ingestion/current/fixtures/`, Rust request handling and policy in `services/collector/src/transport/http/`, `services/collector/src/domain/`, and `services/collector/src/application/`, plus `packages/transport/src/fetch-transport.ts` and its tests. Suggested validation commands are `pnpm http:validate`, `pnpm --filter @web-analytics/transport test`, and `cargo test -p collector`.
