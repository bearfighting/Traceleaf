export function validateOpenApi(document, errors) {
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
