type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const own = (value: object, key: string): boolean => Object.hasOwn(value, key);
const onlyKeys = (value: object, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));
const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const siteId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const originPattern =
  /^https?:\/\/(([A-Za-z0-9-]+\.)*[A-Za-z0-9-]*[A-Za-z][A-Za-z0-9-]*|(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}|\[[A-Fa-f0-9.]*:[A-Fa-f0-9:.]*\])(:(0|[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?\/?$/;
const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const prohibited = new Set([
  "email",
  "emailaddress",
  "useremail",
  "phone",
  "phonenumber",
  "name",
  "firstname",
  "lastname",
  "fullname",
  "address",
  "homeaddress",
  "streetaddress",
  "ip",
  "ipaddress",
  "useragent",
  "cookie",
  "password",
  "passwd",
  "token",
  "userid",
  "useridentifier",
]);

export function validateEvent(value: unknown): boolean {
  if (!object(value)) return false;
  if (
    value.schema_version !== 1 ||
    typeof value.event_id !== "string" ||
    !ulid.test(value.event_id)
  )
    return false;
  if (typeof value.site_id !== "string" || !siteId.test(value.site_id)) return false;
  if (!Number.isSafeInteger(value.occurred_at) || (value.occurred_at as number) < 0) return false;

  if (value.type === "page_view") {
    const allowed = [
      "schema_version",
      "event_id",
      "type",
      "site_id",
      "occurred_at",
      "url",
      "path",
      "title",
      "referrer",
      "visitor_id",
      "context_schema_version",
      "context",
    ];
    if (typeof value.path !== "string" || !value.path.startsWith("/") || value.path.length > 2048)
      return false;
    if (
      value.url !== undefined &&
      (typeof value.url !== "string" || value.url.length > 4096 || !absoluteUri(value.url))
    )
      return false;
    if (
      value.referrer !== undefined &&
      (typeof value.referrer !== "string" ||
        value.referrer.length > 4096 ||
        !uriReference(value.referrer))
    )
      return false;
    if (value.title !== undefined && (typeof value.title !== "string" || value.title.length > 512))
      return false;
    if (
      value.visitor_id !== undefined &&
      (typeof value.visitor_id !== "string" || !uuid.test(value.visitor_id))
    )
      return false;
    if (own(value, "context") !== own(value, "context_schema_version")) return false;
    if (own(value, "context_schema_version") && value.context_schema_version !== 1) return false;
    return !own(value, "context") || validateContext(value.context);
  }

  if (value.type === "custom_event") {
    const allowed = [
      "schema_version",
      "event_id",
      "type",
      "site_id",
      "occurred_at",
      "event_name",
      "properties",
      "visitor_id",
    ];
    return (
      onlyKeys(value, allowed) &&
      typeof value.event_name === "string" &&
      /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value.event_name) &&
      (value.visitor_id === undefined ||
        (typeof value.visitor_id === "string" && uuid.test(value.visitor_id))) &&
      validateProperties(value.properties)
    );
  }

  if (value.type === "web_vital") {
    const allowed = [
      "schema_version",
      "event_id",
      "type",
      "site_id",
      "occurred_at",
      "page_view_event_id",
      "path",
      "page_view_occurred_at",
      "metric",
      "value",
      "rating",
      "navigation_type",
      "report_sequence",
    ];
    const metrics = ["LCP", "INP", "CLS", "FCP", "TTFB"];
    const navigation = ["navigate", "reload", "back_forward", "prerender"];
    const thresholds: Record<string, readonly [number, number, number]> = {
      LCP: [2500, 4000, 600000],
      INP: [200, 500, 600000],
      CLS: [0.1, 0.25, 100],
      FCP: [1800, 3000, 600000],
      TTFB: [800, 1800, 600000],
    };
    if (
      !onlyKeys(value, allowed) ||
      typeof value.page_view_event_id !== "string" ||
      !ulid.test(value.page_view_event_id) ||
      typeof value.path !== "string" ||
      !value.path.startsWith("/") ||
      value.path.length > 2048 ||
      !Number.isSafeInteger(value.page_view_occurred_at) ||
      (value.page_view_occurred_at as number) < 0 ||
      !metrics.includes(value.metric as string) ||
      typeof value.value !== "number" ||
      !Number.isFinite(value.value) ||
      value.value < 0 ||
      !["good", "needs_improvement", "poor"].includes(value.rating as string) ||
      !navigation.includes(value.navigation_type as string) ||
      !Number.isSafeInteger(value.report_sequence) ||
      (value.report_sequence as number) < 1
    )
      return false;
    const [good, needs, max] = thresholds[value.metric as string];
    const expected =
      value.value <= good ? "good" : value.value <= needs ? "needs_improvement" : "poor";
    return (
      value.value <= max &&
      value.rating === expected &&
      (value.page_view_occurred_at as number) <= (value.occurred_at as number)
    );
  }
  return false;
}

export function validateEventBatch(value: unknown): boolean {
  if (
    !object(value) ||
    value.schema_version !== 1 ||
    !Array.isArray(value.events) ||
    value.events.length < 1 ||
    value.events.length > 100
  )
    return false;
  const events = value.events as unknown[];
  return (
    events.every(validateEvent) &&
    events.every(
      (event) =>
        (event as Record<string, unknown>).site_id ===
        (events[0] as Record<string, unknown>).site_id,
    )
  );
}

export function validatePolicy(value: unknown): boolean {
  const fields = [
    "schema_version",
    "site_id",
    "environment",
    "version",
    "updated_at",
    "enabled",
    "allowed_origins",
    "ingest_keys",
    "rate_limit_per_minute",
  ];
  if (
    !object(value) ||
    !onlyKeys(value, fields) ||
    value.schema_version !== 1 ||
    typeof value.site_id !== "string" ||
    value.site_id.length < 1 ||
    typeof value.environment !== "string" ||
    value.environment.length < 1 ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1 ||
    typeof value.updated_at !== "string" ||
    !validDateTime(value.updated_at) ||
    typeof value.enabled !== "boolean" ||
    !Array.isArray(value.allowed_origins) ||
    value.allowed_origins.length < 1 ||
    !Array.isArray(value.ingest_keys) ||
    !Number.isSafeInteger(value.rate_limit_per_minute) ||
    (value.rate_limit_per_minute as number) < 1
  )
    return false;
  const origins = value.allowed_origins as unknown[];
  if (origins.some((origin) => typeof origin !== "string" || !originPattern.test(origin)))
    return false;
  if (new Set(origins).size !== origins.length) return false;
  return (value.ingest_keys as unknown[]).every((key) => {
    const allowed = ["key_id", "sha256_digest", "created_at"];
    return (
      object(key) &&
      onlyKeys(key, allowed) &&
      typeof key.key_id === "string" &&
      /^ik_[A-Za-z0-9_-]{8,64}$/.test(key.key_id) &&
      typeof key.sha256_digest === "string" &&
      /^[a-f0-9]{64}$/.test(key.sha256_digest) &&
      typeof key.created_at === "string" &&
      validDateTime(key.created_at)
    );
  });
}

function validateContext(value: unknown): boolean {
  const fields = [
    "language",
    "timezone",
    "viewport_width",
    "viewport_height",
    "screen_width",
    "screen_height",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "referrer",
    "user_agent",
  ];
  const required = [
    "language",
    "timezone",
    "viewport_width",
    "viewport_height",
    "screen_width",
    "screen_height",
    "user_agent",
  ];
  if (!object(value) || !onlyKeys(value, fields) || required.some((key) => !own(value, key)))
    return false;
  for (const [key, limit] of [
    ["language", 64],
    ["timezone", 64],
    ["utm_source", 256],
    ["utm_medium", 256],
    ["utm_campaign", 256],
    ["utm_term", 256],
    ["utm_content", 256],
    ["referrer", 4096],
    ["user_agent", 1024],
  ] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > limit))
      return false;
  }
  for (const key of ["viewport_width", "viewport_height", "screen_width", "screen_height"]) {
    const dim = value[key];
    if (!(
      dim === "unknown" ||
      (Number.isSafeInteger(dim) && (dim as number) >= 0 && (dim as number) <= 100000)
    ))
      return false;
  }
  return true;
}

function validateProperties(value: unknown): boolean {
  if (!object(value)) return false;
  let keys = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (item === null || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item === "string") return new TextEncoder().encode(item).length <= 256;
    if (Array.isArray(item))
      return depth <= 4 && item.length <= 20 && item.every((child) => visit(child, depth + 1));
    if (!object(item) || depth > 4) return false;
    for (const [key, child] of Object.entries(item)) {
      keys++;
      if (
        keys > 32 ||
        !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) ||
        prohibited.has(key.toLowerCase().replace(/[_.-]/g, "")) ||
        !visit(child, depth + 1)
      )
        return false;
    }
    return true;
  };
  if (!visit(value, 0)) return false;
  return new TextEncoder().encode(JSON.stringify(value)).length <= 8192;
}

function validDateTime(value: string): boolean {
  if (!rfc3339.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const time = value
    .match(/T(\d{2}):(\d{2}):(\d{2})/)
    ?.slice(1)
    .map(Number);
  return !!time && time[0] <= 23 && time[1] <= 59 && time[2] <= 60;
}
function absoluteUri(value: string): boolean {
  try {
    const url = new URL(value);
    return !!url.protocol;
  } catch {
    return false;
  }
}
function uriReference(value: string): boolean {
  if (value === "") return true;
  if (/[\u0000-\u0020]/.test(value)) return false;
  try {
    new URL(value, "https://schema.invalid/");
    return true;
  } catch {
    return false;
  }
}
