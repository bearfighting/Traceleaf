export function validateFixture(fixture, fixtureName, ids, errors) {
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
  validateInputEvents(fixture, fixtureName, errors);
  validateRawEventExpectations(fixture, fixtureName, errors);
  validateAggregateArray(fixture.expected?.page_view_daily, fixtureName, "page_view_daily", errors);
  validateRouteArray(fixture.expected?.page_view_routes, fixtureName, errors);
  validateTotalArray(fixture.expected?.page_view_totals, fixtureName, errors);
  validateApiResponses(fixture.expected?.api, fixtureName, errors);
  if (fixture.expected?.api?.unknown_site)
    validateUnknownSiteResponses(fixture.expected.api.unknown_site, fixtureName, errors);
  validateScenarioSemantics(fixture, fixtureName, errors);
}

export function validateInputEvents(fixture, fixtureName, errors) {
  for (const event of fixture.input?.events ?? []) {
    if (!isEventIdentity(event)) errors.push(`${fixtureName}: input event has invalid identity`);
  }
}

export function validateRawEventExpectations(fixture, fixtureName, errors) {
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

export function validateScenarioSemantics(fixture, fixtureName, errors) {
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

export function validateAggregateArray(items, fixtureName, label, errors) {
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

export function validateRouteArray(items, fixtureName, errors) {
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

export function validateTotalArray(items, fixtureName, errors) {
  if (!Array.isArray(items))
    return errors.push(`${fixtureName}: expected.page_view_totals must be an array`);
  for (const item of items) {
    if (!isSiteId(item?.site_id) || !Number.isInteger(item?.page_views) || item.page_views < 0) {
      errors.push(`${fixtureName}: page_view_totals contains an invalid item`);
    }
  }
}

export function validateApiResponses(api, fixtureName, errors) {
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

export function validateUnknownSiteResponses(api, fixtureName, errors) {
  validateApiResponses(api, `${fixtureName}:unknown_site`, errors);
  for (const name of ["overview", "range_overview"]) {
    if (api[name]?.body?.page_views !== 0)
      errors.push(`${fixtureName}: unknown site ${name} must return page_views 0`);
  }
  for (const name of ["timeline", "pages"]) {
    if (api[name]?.body?.items?.length !== 0)
      errors.push(`${fixtureName}: unknown site ${name} must return empty items`);
  }
}

export function isSorted(items, compare) {
  return items.every((item, index) => index === 0 || compare(items[index - 1], item) <= 0);
}

export function comparePageItems(left, right) {
  return right.page_views - left.page_views || left.path.localeCompare(right.path);
}

export function isEventIdentity(event) {
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

export function isSiteId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

export function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isIsoDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
