import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesDirectory = path.join(
  repositoryRoot,
  "protocol",
  "contracts",
  "http-ingestion",
  "current",
  "fixtures",
);
const allowedStatuses = new Set([200, 202, 204, 400, 401, 403, 413, 415, 429, 500]);
const requiredRequestFields = ["method", "path", "headers", "body"];
const requiredFixtureIds = new Set([
  "health-success",
  "accepted-single-event",
  "accepted-multi-event",
  "accepted-unknown-fields",
  "accepted-charset",
  "invalid-json",
  "invalid-event-missing-required-field",
  "invalid-event-type",
  "invalid-occurred-at",
  "empty-batch",
  "oversized-batch",
  "oversized-body",
  "unsupported-content-type",
  "mixed-site-ids",
  "unknown-site",
  "disabled-site",
  "missing-origin",
  "disallowed-origin",
  "missing-ingest-key",
  "invalid-ingest-key",
  "preflight-success",
  "preflight-missing-origin",
  "preflight-disallowed-origin",
  "preflight-invalid-method",
  "preflight-invalid-header",
  "origin-wrong-scheme",
  "origin-wrong-host",
  "origin-wrong-port",
  "rate-limited",
  "collector-error",
]);
const ids = new Set();
const errors = [];

const fixtureNames = (await readdir(fixturesDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();

if (fixtureNames.length === 0) {
  errors.push("No HTTP fixtures found.");
}

for (const fixtureName of fixtureNames) {
  const fixturePath = path.join(fixturesDirectory, fixtureName);
  let fixture;

  try {
    fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  } catch (error) {
    errors.push(`${fixtureName}: invalid fixture JSON (${error.message})`);
    continue;
  }

  validateFixture(fixture, fixtureName);
}

for (const requiredId of requiredFixtureIds) {
  if (!ids.has(requiredId)) {
    errors.push(`Missing required HTTP fixture '${requiredId}'.`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${fixtureNames.length} HTTP fixtures.`);
}

function validateFixture(fixture, fixtureName) {
  if (!isPlainObject(fixture)) {
    errors.push(`${fixtureName}: fixture must be an object.`);
    return;
  }

  if (typeof fixture.id !== "string" || fixture.id.length === 0) {
    errors.push(`${fixtureName}: id must be a non-empty string.`);
  } else if (ids.has(fixture.id)) {
    errors.push(`${fixtureName}: duplicate fixture id '${fixture.id}'.`);
  } else {
    ids.add(fixture.id);
  }

  if (!isPlainObject(fixture.request)) {
    errors.push(`${fixtureName}: request must be an object.`);
  } else {
    for (const field of requiredRequestFields) {
      if (!(field in fixture.request)) {
        errors.push(`${fixtureName}: request.${field} is required.`);
      }
    }

    if (typeof fixture.request.method !== "string") {
      errors.push(`${fixtureName}: request.method must be a string.`);
    } else if (!new Set(["GET", "POST", "OPTIONS"]).has(fixture.request.method)) {
      errors.push(`${fixtureName}: request.method is not supported.`);
    }
    if (typeof fixture.request.path !== "string" || !fixture.request.path.startsWith("/")) {
      errors.push(`${fixtureName}: request.path must be an absolute path.`);
    } else if (
      (fixture.request.method === "GET" && fixture.request.path !== "/health") ||
      (fixture.request.method !== "GET" && fixture.request.path !== "/v1/events")
    ) {
      errors.push(`${fixtureName}: request method/path does not match the Phase 2 contract.`);
    }
    validateHeaders(fixture.request.headers, `${fixtureName}: request.headers`);
    if (typeof fixture.request.body !== "string") {
      errors.push(`${fixtureName}: request.body must be a string.`);
    }
  }

  if (!isPlainObject(fixture.expected)) {
    errors.push(`${fixtureName}: expected must be an object.`);
    return;
  }

  if (!Number.isInteger(fixture.expected.status) || !allowedStatuses.has(fixture.expected.status)) {
    errors.push(`${fixtureName}: expected.status is not a supported HTTP status.`);
  }
  validateHeaders(fixture.expected.headers, `${fixtureName}: expected.headers`);
  if (typeof fixture.expected.body !== "string") {
    errors.push(`${fixtureName}: expected.body must be a string.`);
  } else if (fixture.expected.body.length > 0) {
    try {
      JSON.parse(fixture.expected.body);
    } catch (error) {
      errors.push(`${fixtureName}: expected.body must contain valid JSON (${error.message}).`);
    }
  }

  if (typeof fixture.request?.body === "string") {
    validateScenarioBody(fixture, fixtureName);
  }
  validateSetup(fixture, fixtureName);
  validateResponseSemantics(fixture, fixtureName);
}

function validateHeaders(headers, label) {
  if (!isPlainObject(headers)) {
    errors.push(`${label} must be an object.`);
    return;
  }

  for (const [name, value] of Object.entries(headers)) {
    if (name !== name.toLowerCase()) {
      errors.push(`${label}: header '${name}' must use lowercase notation.`);
    }
    if (typeof value !== "string") {
      errors.push(`${label}: header '${name}' must have a string value.`);
    }
  }
}

function validateScenarioBody(fixture, fixtureName) {
  const body = fixture.request.body;

  if (fixture.id === "oversized-body" && Buffer.byteLength(body, "utf8") <= 64 * 1024) {
    errors.push(`${fixtureName}: oversized-body must exceed 64 KiB.`);
  }

  if (fixture.id === "oversized-batch") {
    try {
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed.events) || parsed.events.length !== 101) {
        errors.push(`${fixtureName}: oversized-batch must contain exactly 101 events.`);
      }
    } catch {
      errors.push(`${fixtureName}: oversized-batch body must be valid JSON.`);
    }
  }

  if (fixture.request.method === "POST" && fixture.id !== "invalid-json") {
    try {
      const parsed = JSON.parse(body);
      if (fixture.expected.status === 202) {
        if (
          parsed.schema_version !== 1 ||
          !Array.isArray(parsed.events) ||
          parsed.events.length < 1 ||
          parsed.events.length > 100
        ) {
          errors.push(
            `${fixtureName}: successful POST must contain an EventBatch with 1-100 events.`,
          );
        }
      }
    } catch (error) {
      errors.push(
        `${fixtureName}: POST body must be valid JSON unless it is the invalid-json fixture (${error.message}).`,
      );
    }
  }
}

function validateSetup(fixture, fixtureName) {
  if (!new Set(["POST", "OPTIONS"]).has(fixture.request?.method)) {
    return;
  }

  if (!isPlainObject(fixture.setup)) {
    errors.push(`${fixtureName}: POST/OPTIONS fixtures must define setup.`);
    return;
  }

  if (typeof fixture.setup.config !== "string") {
    errors.push(`${fixtureName}: setup.config must be a string.`);
  } else if (!existsSync(path.resolve(fixturesDirectory, fixture.setup.config))) {
    errors.push(`${fixtureName}: setup.config does not reference an existing file.`);
  }

  if (fixture.setup.rate_limit !== undefined) {
    const rateLimit = fixture.setup.rate_limit;
    if (
      !isPlainObject(rateLimit) ||
      typeof rateLimit.site_id !== "string" ||
      typeof rateLimit.origin !== "string" ||
      !Number.isInteger(rateLimit.requests)
    ) {
      errors.push(`${fixtureName}: setup.rate_limit is invalid.`);
    } else if (fixture.id === "rate-limited" && rateLimit.requests !== 601) {
      errors.push(`${fixtureName}: rate-limited setup must specify exactly 601 requests.`);
    }
  }

  if (fixture.setup.sink !== undefined && fixture.setup.sink !== "error") {
    errors.push(`${fixtureName}: setup.sink must be 'error' when present.`);
  }
}

function validateResponseSemantics(fixture, fixtureName) {
  const { request, expected } = fixture;

  if (!isPlainObject(request) || !isPlainObject(expected)) {
    return;
  }

  if (expected.status === 204 && expected.body !== "") {
    errors.push(`${fixtureName}: 204 responses must have an empty body.`);
  }

  if (request.method === "OPTIONS" && expected.status === 204) {
    const requiredHeaders = {
      "access-control-allow-origin": request.headers.origin,
      "access-control-allow-methods": "POST",
      "access-control-allow-headers": "Content-Type, X-Ingest-Key",
      "access-control-max-age": "600",
      vary: "Origin",
    };

    for (const [name, value] of Object.entries(requiredHeaders)) {
      if (expected.headers?.[name] !== value) {
        errors.push(`${fixtureName}: successful preflight must include ${name}: ${value}.`);
      }
    }
  }

  if (request.method === "OPTIONS" && typeof request.headers?.origin === "string") {
    if (expected.headers?.vary !== "Origin") {
      errors.push(`${fixtureName}: preflight response must include Vary: Origin.`);
    }
    if (
      expected.status !== 204 &&
      expected.headers?.["access-control-allow-origin"] !== undefined
    ) {
      errors.push(`${fixtureName}: rejected preflight must not allow an Origin.`);
    }
    if (expected.status !== 204) {
      if (expected.status !== 403) {
        errors.push(`${fixtureName}: rejected preflight must return 403.`);
      }
      if (errorCodeFromBody(expected.body) !== "origin_not_allowed") {
        errors.push(`${fixtureName}: rejected preflight must return origin_not_allowed.`);
      }
    }
  }

  if (request.method === "OPTIONS" && typeof request.headers?.origin !== "string") {
    if (expected.status !== 403) {
      errors.push(`${fixtureName}: preflight without Origin must return 403.`);
    }
    if (errorCodeFromBody(expected.body) !== "origin_not_allowed") {
      errors.push(`${fixtureName}: preflight without Origin must return origin_not_allowed.`);
    }
  }

  if (request.method === "POST" && typeof request.headers?.origin === "string") {
    if (expected.headers?.vary !== "Origin") {
      errors.push(`${fixtureName}: POST response must include Vary: Origin.`);
    }
    const errorCode = errorCodeFromBody(expected.body);

    if (errorCode !== "origin_not_allowed" && errorCode !== "site_not_allowed") {
      if (expected.headers?.["access-control-allow-origin"] !== request.headers.origin) {
        errors.push(`${fixtureName}: POST response must echo the allowlisted Origin.`);
      }
    }
  }

  if (fixture.id === "rate-limited") {
    if (expected.status !== 429 || expected.headers?.["retry-after"] !== "60") {
      errors.push(`${fixtureName}: rate-limited must return 429 with Retry-After: 60.`);
    }
  }
}

function errorCodeFromBody(body) {
  try {
    return JSON.parse(body)?.error?.code;
  } catch {
    return undefined;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
