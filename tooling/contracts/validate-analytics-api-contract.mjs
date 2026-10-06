/* global console, process */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const openapiPath = path.join(root, "docs", "analytics-api.openapi.json");
const contractRoot = path.join(root, "protocol", "contracts", "analytics-api", "current");
const fixturesDirectory = path.join(contractRoot, "fixtures");
const queryCasesPath = path.join(contractRoot, "api-contract-cases.json");
const requiredIds = new Set([
  "single-page-view",
  "multi-page-navigation",
  "duplicate-events",
  "late-event",
  "multi-site-isolation",
  "empty-date-range",
  "all-time-overview",
  "custom-events",
  "web-vitals",
  "conversion-funnels",
  "geo-countries",
]);
const errors = [];

const openapi = await readJson(openapiPath, "OpenAPI contract");
if (openapi) validateOpenApi(openapi);
const queryCases = await readJson(queryCasesPath, "Analytics API contract cases");
if (queryCases) validateQueryCases(queryCases);

const fixtureNames = (await readdir(fixturesDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();
const ids = new Set();
for (const fixtureName of fixtureNames) {
  const fixture = await readJson(path.join(fixturesDirectory, fixtureName), fixtureName);
  if (fixture) validateFixture(fixture, fixtureName, ids);
}

for (const id of requiredIds) {
  if (!ids.has(id)) errors.push(`missing required fixture '${id}'`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated analytics contract and ${fixtureNames.length} fixtures.`);
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label}: invalid JSON (${error.message})`);
    return null;
  }
}

function validateOpenApi(document) {
  if (document.openapi !== "3.1.0") errors.push("OpenAPI contract must use version 3.1.0");
  for (const pathName of [
    "/health",
    "/v1/sites/{site_id}/overview",
    "/v1/sites/{site_id}/reports/{from}/{to}/overview",
    "/v1/sites/{site_id}/reports/{from}/{to}/timeline",
    "/v1/sites/{site_id}/reports/{from}/{to}/pages",
    "/v1/sites/{site_id}/reports/{from}/{to}/geo",
    "/v1/sites/{site_id}/reports/{from}/{to}/events",
    "/v1/sites/{site_id}/reports/{from}/{to}/conversions",
    "/v1/sites/{site_id}/reports/{from}/{to}/funnels",
    "/v1/sites/{site_id}/reports/{from}/{to}/web-vitals",
    "/v1/sites/{site_id}/reports/{from}/{to}/visitors",
    "/v1/sites/{site_id}/reports/{from}/{to}/sessions",
    "/v1/sites/{site_id}/reports/{from}/{to}/dimensions/{dimension}",
  ]) {
    if (!document.paths?.[pathName]?.get)
      errors.push(`OpenAPI contract is missing GET ${pathName}`);
  }
  const expectedResponses = {
    "/health": ["200", "503"],
    "/v1/sites/{site_id}/overview": ["200", "500"],
    "/v1/sites/{site_id}/reports/{from}/{to}/overview": ["200", "400", "500"],
    "/v1/sites/{site_id}/reports/{from}/{to}/timeline": ["200", "400", "500"],
    "/v1/sites/{site_id}/reports/{from}/{to}/pages": ["200", "400", "500"],
    "/v1/sites/{site_id}/reports/{from}/{to}/geo": ["200", "400", "500"],
    "/v1/sites/{site_id}/reports/{from}/{to}/events": ["200", "400", "500"],
    "/v1/sites/{site_id}/reports/{from}/{to}/conversions": ["200", "400", "500"],
    "/v1/sites/{site_id}/reports/{from}/{to}/funnels": ["200", "400", "500"],
    "/v1/sites/{site_id}/reports/{from}/{to}/web-vitals": ["200", "400", "500"],
    "/v1/sites/{site_id}/reports/{from}/{to}/visitors": ["200", "400", "404", "500"],
    "/v1/sites/{site_id}/reports/{from}/{to}/sessions": ["200", "400", "404", "500"],
    "/v1/sites/{site_id}/reports/{from}/{to}/dimensions/{dimension}": ["200", "400", "404", "500"],
  };
  for (const [pathName, statuses] of Object.entries(expectedResponses)) {
    for (const status of statuses) {
      if (!document.paths?.[pathName]?.get?.responses?.[status])
        errors.push(`OpenAPI contract is missing ${status} response for ${pathName}`);
    }
  }
  for (const schemaName of [
    "OverviewResponse",
    "RangeOverviewResponse",
    "TimelineResponse",
    "PagesResponse",
    "GeoCountryReportResponse",
    "EventsReportResponse",
    "ConversionReportResponse",
    "ConversionReportItem",
    "FunnelReportResponse",
    "FunnelReportItem",
    "EventDailyItem",
    "VisitorSessionReportResponse",
    "DimensionReportResponse",
    "DimensionName",
    "ErrorResponse",
  ]) {
    if (!document.components?.schemas?.[schemaName])
      errors.push(`OpenAPI contract is missing schema ${schemaName}`);
  }
  if (!document.components?.responses?.InvalidQuery) {
    errors.push("OpenAPI contract is missing the shared 400 InvalidQuery response");
  }
  for (const schemaName of ["OverviewResponse", "TimelineResponse", "PagesResponse"]) {
    if (document.components?.schemas?.[schemaName]?.allOf) {
      errors.push(`${schemaName} must be a standalone object schema`);
    }
  }
  const errorCodes = document.components?.schemas?.ErrorBody?.properties?.code?.enum;
  for (const code of [
    "invalid_date_range",
    "date_range_too_large",
    "invalid_limit",
    "invalid_event_name",
    "invalid_dimension",
    "analytics_not_enabled",
    "analytics_api_error",
  ]) {
    if (!errorCodes?.includes(code)) errors.push(`OpenAPI contract is missing error code ${code}`);
  }
  for (const pathName of [
    "/v1/sites/{site_id}/reports/{from}/{to}/overview",
    "/v1/sites/{site_id}/reports/{from}/{to}/timeline",
    "/v1/sites/{site_id}/reports/{from}/{to}/pages",
    "/v1/sites/{site_id}/reports/{from}/{to}/geo",
    "/v1/sites/{site_id}/reports/{from}/{to}/events",
    "/v1/sites/{site_id}/reports/{from}/{to}/conversions",
    "/v1/sites/{site_id}/reports/{from}/{to}/funnels",
    "/v1/sites/{site_id}/reports/{from}/{to}/web-vitals",
    "/v1/sites/{site_id}/reports/{from}/{to}/visitors",
    "/v1/sites/{site_id}/reports/{from}/{to}/sessions",
    "/v1/sites/{site_id}/reports/{from}/{to}/dimensions/{dimension}",
  ]) {
    const parameters = document.paths?.[pathName]?.get?.parameters ?? [];
    for (const parameter of ["FromPath", "ToPath"]) {
      if (!parameters.some((item) => item.$ref === `#/components/parameters/${parameter}`))
        errors.push(`${pathName} must require ${parameter}`);
    }
  }

  for (const pathName of [
    "/v1/sites/{site_id}/reports/{from}/{to}/visitors",
    "/v1/sites/{site_id}/reports/{from}/{to}/sessions",
    "/v1/sites/{site_id}/reports/{from}/{to}/dimensions/{dimension}",
  ]) {
    const operation = document.paths?.[pathName]?.get;
    if (operation?.["x-phase"] !== 6) errors.push(`${pathName} must be marked with x-phase 6`);
    if (operation?.["x-lifecycle"] !== "enabled-behind-feature-flag")
      errors.push(`${pathName} must be marked enabled-behind-feature-flag`);
  }

  const dimensionParameter = document.components?.parameters?.Dimension;
  if (dimensionParameter?.schema?.$ref !== "#/components/schemas/DimensionName")
    errors.push("Dimension parameter must use the DimensionName schema");

  const limitParameter = document.components?.parameters?.Limit;
  const limitSchema = limitParameter?.schema;
  if (
    limitParameter?.in !== "query" ||
    limitParameter?.required !== false ||
    limitSchema?.type !== "integer" ||
    limitSchema?.minimum !== 1 ||
    limitSchema?.maximum !== 100 ||
    limitSchema?.default !== 20
  ) {
    errors.push("Limit parameter must be an optional integer from 1 to 100 with default 20");
  }

  const dimensionPath =
    document.paths?.["/v1/sites/{site_id}/reports/{from}/{to}/dimensions/{dimension}"]?.get;
  for (const parameter of ["Dimension", "Limit"]) {
    if (
      !dimensionPath?.parameters?.some(
        (item) => item.$ref === `#/components/parameters/${parameter}`,
      )
    )
      errors.push(`Dimension endpoint must require ${parameter}`);
  }

  if (!dimensionPath?.description?.toLowerCase().includes("feature flag"))
    errors.push("Dimension endpoint must document its feature flag requirement");
  if (!dimensionPath?.description?.includes("page_views descending"))
    errors.push("Dimension endpoint must document page_views descending ordering");
  if (!dimensionPath?.description?.includes("value ascending"))
    errors.push("Dimension endpoint must document value ascending tie-breaking");

  for (const pathName of [
    "/v1/sites/{site_id}/reports/{from}/{to}/visitors",
    "/v1/sites/{site_id}/reports/{from}/{to}/sessions",
  ]) {
    if (!document.paths?.[pathName]?.get?.description?.includes("day ascending"))
      errors.push(`${pathName} must document day ascending ordering`);
  }

  const dimensionNames = [
    "language",
    "timezone",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "referrer_host",
    "device",
    "browser",
    "os",
  ];
  const actualDimensionNames = document.components?.schemas?.DimensionName?.enum;
  if (JSON.stringify(actualDimensionNames) !== JSON.stringify(dimensionNames))
    errors.push("DimensionName enum does not match the analytics dimension allowlist");

  for (const schemaName of ["VisitorSessionReportResponse", "DimensionReportResponse"]) {
    const schema = document.components?.schemas?.[schemaName];
    if (!schema?.required?.includes("data_as_of"))
      errors.push(`${schemaName} must require data_as_of`);
    if (!schema?.required?.includes("freshness_status"))
      errors.push(`${schemaName} must require freshness_status`);
    const dataAsOf = schema?.properties?.data_as_of;
    if (
      !Array.isArray(dataAsOf?.type) ||
      !dataAsOf.type.includes("string") ||
      !dataAsOf.type.includes("null")
    )
      errors.push(`${schemaName}.data_as_of must allow string and null`);
    if (!dataAsOf?.description?.includes("Common processed_received watermark"))
      errors.push(`${schemaName}.data_as_of must document the common freshness watermark`);
    const freshnessStatus = schema?.properties?.freshness_status;
    if (
      freshnessStatus?.type !== "string" ||
      JSON.stringify(freshnessStatus.enum) !==
        JSON.stringify(["current", "stale", "rebuilding", "failed"])
    )
      errors.push(`${schemaName}.freshness_status must expose the analytics freshness status enum`);
  }

  const dimensionResponse = dimensionPath?.responses?.["200"];
  if (!dimensionResponse?.description?.includes("UTC date range"))
    errors.push("Dimension response must document its UTC date range");
  if (!document.info?.description?.includes("Phase 6"))
    errors.push("OpenAPI info must identify analytics report paths");
}

function validateQueryCases(document) {
  if (!Array.isArray(document.cases) || document.cases.length === 0) {
    errors.push("Analytics API contract cases must be a non-empty array");
    return;
  }
  const ids = new Set();
  for (const testCase of document.cases) {
    if (!testCase?.id || ids.has(testCase.id))
      errors.push("Analytics API contract case IDs must be unique and non-empty");
    ids.add(testCase?.id);
    if (typeof testCase.path !== "string" || !testCase.path.includes("/reports/"))
      errors.push(`${testCase.id}: case path must be a reports path`);
    if (testCase.expected?.status !== 400)
      errors.push(`${testCase.id}: contract case must expect HTTP 400`);
    if (!testCase.expected?.error_code)
      errors.push(`${testCase.id}: expected.error_code is required`);
  }
  for (const code of [
    "invalid_date_range",
    "date_range_too_large",
    "invalid_limit",
    "invalid_event_name",
  ]) {
    if (!document.cases.some((testCase) => testCase.expected.error_code === code))
      errors.push(`missing API contract case for ${code}`);
  }
  for (const testCase of document.cases) validateQueryCaseSemantics(testCase);
}

function validateQueryCaseSemantics(testCase) {
  const path = testCase.path.split("?")[0];
  const segments = path.split("/");
  const from = segments[5];
  const to = segments[6];
  const expectedCode = testCase.expected.error_code;
  if (expectedCode === "invalid_date_range" && isDate(from) && isDate(to) && from < to)
    errors.push(`${testCase.id}: invalid_date_range case must have invalid or reversed dates`);
  if (expectedCode === "date_range_too_large" && isDate(from) && isDate(to)) {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
    if (days <= 366) errors.push(`${testCase.id}: date_range_too_large case must exceed 366 days`);
  }
  if (
    expectedCode === "invalid_limit" &&
    !/(?:^|&)limit=(?:0|101)(?:&|$)/.test(testCase.path.split("?")[1] ?? "")
  )
    errors.push(`${testCase.id}: invalid_limit case must use an out-of-range limit`);
}

function validateFixture(fixture, fixtureName, ids) {
  if (!fixture || typeof fixture !== "object")
    return errors.push(`${fixtureName}: fixture must be an object`);
  if (typeof fixture.id !== "string" || !fixture.id) errors.push(`${fixtureName}: id is required`);
  else if (ids.has(fixture.id)) errors.push(`${fixtureName}: duplicate id '${fixture.id}'`);
  else ids.add(fixture.id);
  if (!Array.isArray(fixture.input?.events))
    errors.push(`${fixtureName}: input.events must be an array`);
  if (!isIsoDateTime(fixture.input?.received_at))
    errors.push(`${fixtureName}: input.received_at must be an ISO timestamp`);
  if (fixture.processor?.mode !== "once")
    errors.push(`${fixtureName}: processor.mode must be 'once'`);
  validateInputEvents(fixture, fixtureName);
  validateRawEventExpectations(fixture, fixtureName);
  validateAggregateArray(fixture.expected?.page_view_daily, fixtureName, "page_view_daily");
  validateRouteArray(fixture.expected?.page_view_routes, fixtureName);
  validateTotalArray(fixture.expected?.page_view_totals, fixtureName);
  validateApiResponses(fixture.expected?.api, fixtureName);
  if (fixture.expected?.api?.unknown_site)
    validateUnknownSiteResponses(fixture.expected.api.unknown_site, fixtureName);
  validateScenarioSemantics(fixture, fixtureName);
}

function validateInputEvents(fixture, fixtureName) {
  for (const event of fixture.input?.events ?? []) {
    if (!isEventIdentity(event)) errors.push(`${fixtureName}: input event has invalid identity`);
  }
}

function validateRawEventExpectations(fixture, fixtureName) {
  const rawEvents = fixture.expected?.raw_events;
  if (
    !rawEvents ||
    !Number.isInteger(rawEvents.inserted) ||
    !Number.isInteger(rawEvents.duplicates_ignored) ||
    !Array.isArray(rawEvents.events)
  ) {
    errors.push(
      `${fixtureName}: expected.raw_events must define inserted, duplicates_ignored and events`,
    );
    return;
  }
  if (rawEvents.inserted !== rawEvents.events.length)
    errors.push(`${fixtureName}: raw event inserted count must match events length`);
  const inputEvents = fixture.input?.events ?? [];
  if (rawEvents.inserted + rawEvents.duplicates_ignored !== inputEvents.length)
    errors.push(`${fixtureName}: inserted plus duplicate counts must match input event count`);
  for (const event of rawEvents.events) {
    if (
      !isSiteId(event.site_id) ||
      typeof event.event_id !== "string" ||
      event.event_id.length !== 26 ||
      !isIsoDateTime(event.received_at) ||
      !isEventIdentity(event.payload)
    ) {
      errors.push(
        `${fixtureName}: expected raw event has invalid identity, received_at or payload`,
      );
    }
  }
}

function validateScenarioSemantics(fixture, fixtureName) {
  const inputEvents = fixture.input?.events ?? [];
  const inputIds = inputEvents.map((event) => event.event_id);
  const uniqueIds = new Set(inputIds);
  const duplicateCount = inputIds.length - uniqueIds.size;
  const rawEvents = fixture.expected?.raw_events;
  const totalsBySite = new Map();
  for (const event of rawEvents?.events ?? [])
    if (event.type === "page_view")
      totalsBySite.set(event.site_id, (totalsBySite.get(event.site_id) ?? 0) + 1);
  for (const total of fixture.expected?.page_view_totals ?? []) {
    if (total.page_views !== (totalsBySite.get(total.site_id) ?? 0))
      errors.push(`${fixtureName}: page_view_totals must equal inserted events per site`);
  }

  if (fixture.id === "duplicate-events") {
    if (duplicateCount === 0 || rawEvents.duplicates_ignored !== duplicateCount)
      errors.push(
        `${fixtureName}: duplicate scenario must contain and account for duplicate event IDs`,
      );
  }

  if (
    fixture.id === "multi-site-isolation" &&
    new Set(inputEvents.map((event) => event.site_id)).size < 2
  )
    errors.push(`${fixtureName}: multi-site scenario must contain at least two site IDs`);

  if (fixture.id === "empty-date-range") {
    if (inputEvents.length !== 0 || rawEvents.inserted !== 0 || rawEvents.duplicates_ignored !== 0)
      errors.push(`${fixtureName}: empty-date scenario must contain no events`);
    if (
      fixture.expected.api.overview.body.page_views !== 0 ||
      fixture.expected.api.timeline.body.items.length !== 0 ||
      fixture.expected.api.pages.body.items.length !== 0
    )
      errors.push(`${fixtureName}: empty-date scenario must return empty API results`);
  }

  if (fixture.id === "late-event" && inputEvents.length === 1) {
    const expectedDay = new Date(inputEvents[0].occurred_at).toISOString().slice(0, 10);
    const aggregateDay = fixture.expected.page_view_daily[0]?.day;
    if (aggregateDay !== expectedDay)
      errors.push(`${fixtureName}: late event must aggregate by occurred_at UTC date`);
  }

  const expectedRawIds = new Set(rawEvents.events.map((event) => event.event_id));
  if (expectedRawIds.size !== rawEvents.events.length)
    errors.push(`${fixtureName}: expected raw events must have unique event IDs`);
  for (const event of rawEvents.events) {
    if (
      event.payload.event_id !== event.event_id ||
      event.payload.site_id !== event.site_id ||
      (event.payload.type === "page_view" && event.payload.path !== event.path)
    )
      errors.push(`${fixtureName}: raw event payload must preserve the event identity fields`);
  }

  const overview = fixture.expected?.api?.overview?.body;
  if (overview && overview.page_views !== (totalsBySite.get(overview.site_id) ?? 0))
    errors.push(`${fixtureName}: all-time overview must equal the site total`);
  if (fixture.id === "all-time-overview") {
    const betaOverview = fixture.expected?.api?.site_beta_overview?.body;
    if (!betaOverview || betaOverview.page_views !== (totalsBySite.get("site_beta") ?? 0))
      errors.push(`${fixtureName}: site_beta overview must be isolated and equal its site total`);
    if (!fixture.expected?.api?.unknown_site)
      errors.push(
        `${fixtureName}: all-time overview must include an unknown site empty-result case`,
      );
  }
  const rangeOverview = fixture.expected?.api?.range_overview?.body;
  if (rangeOverview) {
    const rangeTotal = (fixture.expected.page_view_daily ?? [])
      .filter(
        (item) =>
          item.site_id === rangeOverview.site_id &&
          item.day >= rangeOverview.from &&
          item.day <= rangeOverview.to,
      )
      .reduce((sum, item) => sum + item.page_views, 0);
    if (rangeOverview.page_views !== rangeTotal)
      errors.push(`${fixtureName}: range overview must equal daily aggregates in its date range`);
  }
}

function validateAggregateArray(items, fixtureName, label) {
  if (!Array.isArray(items))
    return errors.push(`${fixtureName}: expected.${label} must be an array`);
  for (const item of items) {
    if (
      !isSiteId(item?.site_id) ||
      !isDate(item?.day) ||
      !Number.isInteger(item?.page_views) ||
      item.page_views < 0
    ) {
      errors.push(`${fixtureName}: ${label} contains an invalid item`);
    }
  }
}

function validateRouteArray(items, fixtureName) {
  if (!Array.isArray(items))
    return errors.push(`${fixtureName}: expected.page_view_routes must be an array`);
  for (const item of items) {
    if (
      !isSiteId(item?.site_id) ||
      !isDate(item?.day) ||
      typeof item?.path !== "string" ||
      !item.path.startsWith("/") ||
      !Number.isInteger(item?.page_views) ||
      item.page_views < 0
    ) {
      errors.push(`${fixtureName}: page_view_routes contains an invalid item`);
    }
  }
}

function validateTotalArray(items, fixtureName) {
  if (!Array.isArray(items))
    return errors.push(`${fixtureName}: expected.page_view_totals must be an array`);
  for (const item of items) {
    if (!isSiteId(item?.site_id) || !Number.isInteger(item?.page_views) || item.page_views < 0) {
      errors.push(`${fixtureName}: page_view_totals contains an invalid item`);
    }
  }
}

function validateApiResponses(api, fixtureName) {
  if (!api || typeof api !== "object")
    return errors.push(`${fixtureName}: expected.api must be an object`);
  for (const name of [
    "overview",
    "range_overview",
    "timeline",
    "pages",
    ...(api.events ? ["events"] : []),
    ...(api.web_vitals ? ["web_vitals"] : []),
    ...(api.geo_countries ? ["geo_countries"] : []),
    ...(api.conversions ? ["conversions"] : []),
    ...(api.funnels ? ["funnels"] : []),
  ]) {
    const response = api[name];
    if (
      !response ||
      response.status !== 200 ||
      !response.body ||
      typeof response.body !== "object"
    ) {
      errors.push(`${fixtureName}: expected.api.${name} must be a 200 response with a body`);
      continue;
    }
    if (!isSiteId(response.body.site_id))
      errors.push(`${fixtureName}: ${name} response has invalid site_id`);
    if (name === "overview" && ("from" in response.body || "to" in response.body))
      errors.push(`${fixtureName}: all-time overview must not contain from/to`);
    if (name !== "overview" && (!isDate(response.body.from) || !isDate(response.body.to)))
      errors.push(`${fixtureName}: ${name} response has invalid date range`);
    if (
      (name === "overview" || name === "range_overview") &&
      (!Number.isInteger(response.body.page_views) || response.body.page_views < 0)
    )
      errors.push(`${fixtureName}: ${name} page_views must be a non-negative integer`);
    if (
      (name === "timeline" ||
        name === "pages" ||
        name === "events" ||
        name === "geo_countries" ||
        name === "conversions" ||
        name === "funnels") &&
      !Array.isArray(response.body.items)
    )
      errors.push(`${fixtureName}: ${name} items must be an array`);
    if (
      name === "geo_countries" &&
      !response.body.items.every(
        (item) =>
          typeof item.country_code === "string" &&
          (item.country_code === "unknown" || /^[A-Z]{2}$/.test(item.country_code)) &&
          Number.isInteger(item.page_views) &&
          item.page_views >= 0,
      )
    )
      errors.push(`${fixtureName}: geo_countries items are invalid`);
    if (
      name === "geo_countries" &&
      (!Array.isArray(response.body.providers) ||
        !response.body.providers.every((provider) => ["db-ip", "maxmind"].includes(provider)) ||
        new Set(response.body.providers).size !== response.body.providers.length ||
        !Object.hasOwn(response.body, "coverage_from") ||
        !(response.body.coverage_from === null || isDate(response.body.coverage_from)) ||
        !(response.body.data_as_of === null || isIsoDateTime(response.body.data_as_of)) ||
        !["current", "stale", "rebuilding", "failed"].includes(response.body.freshness_status) ||
        response.body.aggregation_version !== 1)
    )
      errors.push(`${fixtureName}: geo_countries freshness and coverage fields are invalid`);
    if (name === "events" && (!Number.isInteger(response.body.total) || response.body.total < 0))
      errors.push(`${fixtureName}: events total must be a non-negative integer`);
    if (
      (name === "conversions" || name === "funnels") &&
      (!Number.isInteger(response.body.total) ||
        response.body.total < 0 ||
        typeof response.body.definition_version !== "string" ||
        !Array.isArray(response.body.items))
    )
      errors.push(`${fixtureName}: ${name} response is invalid`);
    if (
      name === "conversions" &&
      !response.body.items.every(
        (item) =>
          typeof item.definition_id === "string" &&
          isDate(item.day) &&
          Number.isInteger(item.event_count) &&
          Number.isInteger(item.converted_sessions) &&
          Number.isInteger(item.eligible_sessions) &&
          typeof item.conversion_rate === "number",
      )
    )
      errors.push(`${fixtureName}: conversion items are invalid`);
    if (
      name === "funnels" &&
      !response.body.items.every(
        (item) =>
          typeof item.definition_id === "string" &&
          isDate(item.day) &&
          Number.isInteger(item.step_index) &&
          Number.isInteger(item.sessions) &&
          typeof item.conversion_rate === "number",
      )
    )
      errors.push(`${fixtureName}: funnel items are invalid`);
    if (
      name === "web_vitals" &&
      (!Number.isInteger(response.body.total) ||
        response.body.total < 0 ||
        !Array.isArray(response.body.items) ||
        !response.body.items.every(
          (item) =>
            typeof item.path === "string" &&
            ["LCP", "INP", "CLS", "FCP", "TTFB"].includes(item.metric) &&
            Number.isInteger(item.count) &&
            (item.p75 === null || typeof item.p75 === "number") &&
            ["available", "insufficient_data"].includes(item.status),
        ))
    )
      errors.push(`${fixtureName}: web_vitals items are invalid`);
    if (
      name === "timeline" &&
      !isSorted(response.body.items, (left, right) => left.day.localeCompare(right.day))
    )
      errors.push(`${fixtureName}: timeline items must be sorted by day ascending`);
    if (
      name === "geo_countries" &&
      !isSorted(
        response.body.items,
        (a, b) => b.page_views - a.page_views || a.country_code.localeCompare(b.country_code),
      )
    )
      errors.push(`${fixtureName}: geo_countries items must be sorted by count then country code`);
    if (name === "pages" && !isSorted(response.body.items, comparePageItems))
      errors.push(
        `${fixtureName}: pages items must be sorted by page_views descending and path ascending`,
      );
    if (
      name === "web_vitals" &&
      !isSorted(
        response.body.items,
        (a, b) => a.path.localeCompare(b.path) || a.metric.localeCompare(b.metric),
      )
    )
      errors.push(`${fixtureName}: Web Vitals must sort by path and metric ascending`);
  }
}

function validateUnknownSiteResponses(api, fixtureName) {
  validateApiResponses(api, `${fixtureName}:unknown_site`);
  for (const name of ["overview", "range_overview"]) {
    if (api[name]?.body?.page_views !== 0)
      errors.push(`${fixtureName}: unknown site ${name} must return page_views 0`);
  }
  for (const name of ["timeline", "pages"]) {
    if (api[name]?.body?.items?.length !== 0)
      errors.push(`${fixtureName}: unknown site ${name} must return empty items`);
  }
}

function isSorted(items, compare) {
  return items.every((item, index) => index === 0 || compare(items[index - 1], item) <= 0);
}

function comparePageItems(left, right) {
  return right.page_views - left.page_views || left.path.localeCompare(right.path);
}

function isEventIdentity(event) {
  if (event?.type === "custom_event")
    return (
      event.schema_version === 1 &&
      isSiteId(event.site_id) &&
      typeof event.event_id === "string" &&
      event.event_id.length === 26 &&
      Number.isInteger(event.occurred_at) &&
      typeof event.event_name === "string" &&
      event.properties &&
      typeof event.properties === "object"
    );
  if (event?.type === "web_vital")
    return (
      event.schema_version === 1 &&
      isSiteId(event.site_id) &&
      typeof event.event_id === "string" &&
      event.event_id.length === 26 &&
      Number.isInteger(event.occurred_at) &&
      typeof event.page_view_event_id === "string" &&
      event.page_view_event_id.length === 26 &&
      typeof event.path === "string" &&
      event.path.startsWith("/") &&
      Number.isInteger(event.page_view_occurred_at) &&
      ["LCP", "INP", "CLS", "FCP", "TTFB"].includes(event.metric) &&
      typeof event.value === "number" &&
      ["good", "needs_improvement", "poor"].includes(event.rating) &&
      Number.isInteger(event.report_sequence)
    );
  return (
    event?.schema_version === 1 &&
    isSiteId(event?.site_id) &&
    typeof event?.event_id === "string" &&
    event.event_id.length === 26 &&
    event.type === "page_view" &&
    Number.isInteger(event?.occurred_at) &&
    typeof event?.path === "string" &&
    event.path.startsWith("/")
  );
}

function isSiteId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}
function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function isIsoDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
