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

export function validateResponseSemantics(fixture, fixtureName, errors) {
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
