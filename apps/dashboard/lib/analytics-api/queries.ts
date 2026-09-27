import { ANALYTICS_DIMENSIONS } from "./types";

import type {
  AnalyticsApiErrorResponse,
  OverviewResponse,
  EventDailyItem,
  EventsResponse,
  PageItem,
  PagesResponse,
  RangeOverviewResponse,
  TimelineItem,
  TimelineResponse,
  AnalyticsDimension,
  DimensionResponse,
  FreshnessStatus,
  VisitorSessionResponse,
  WebVitalsResponse,
  ConversionReportResponse,
  FunnelReportResponse,
  GeoCountryResponse,
} from "./types";

export const DEFAULT_PAGES_LIMIT = 20;

export type ResponseValidator<T> = (value: unknown) => value is T;

export function overviewPath(siteId: string): string {
  return `/v1/sites/${encodeURIComponent(siteId)}/overview`;
}

export function rangeOverviewPath(siteId: string, from: string, to: string): string {
  return `/v1/sites/${encodeURIComponent(siteId)}/reports/${from}/${to}/overview`;
}

export function timelinePath(siteId: string, from: string, to: string): string {
  return `/v1/sites/${encodeURIComponent(siteId)}/reports/${from}/${to}/timeline`;
}

export function pagesPath(siteId: string, from: string, to: string, limit: number): string {
  return `/v1/sites/${encodeURIComponent(siteId)}/reports/${from}/${to}/pages?limit=${encodeURIComponent(String(limit))}`;
}

export function eventsPath(
  siteId: string,
  from: string,
  to: string,
  limit = 100,
  eventName?: string,
): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (eventName !== undefined) params.set("event_name", eventName);

  return `/v1/sites/${encodeURIComponent(siteId)}/reports/${from}/${to}/events?${params.toString()}`;
}

export function webVitalsPath(
  siteId: string,
  from: string,
  to: string,
  limit = 20,
  path?: string,
): string {
  const q = new URLSearchParams({ limit: String(limit) });
  if (path !== undefined) q.set("path", path);

  return `/v1/sites/${encodeURIComponent(siteId)}/reports/${from}/${to}/web-vitals?${q.toString()}`;
}

export function conversionsPath(
  siteId: string,
  from: string,
  to: string,
  limit = 20,
  definitionId?: string,
  definitionVersion?: string,
): string {
  const q = new URLSearchParams({ limit: String(limit) });
  if (definitionId !== undefined) q.set("definition_id", definitionId);
  if (definitionVersion !== undefined) q.set("definition_version", definitionVersion);

  return `/v1/sites/${encodeURIComponent(siteId)}/reports/${from}/${to}/conversions?${q.toString()}`;
}

export function funnelsPath(
  siteId: string,
  from: string,
  to: string,
  limit = 20,
  definitionId?: string,
  definitionVersion?: string,
): string {
  const q = new URLSearchParams({ limit: String(limit) });
  if (definitionId !== undefined) q.set("definition_id", definitionId);
  if (definitionVersion !== undefined) q.set("definition_version", definitionVersion);

  return `/v1/sites/${encodeURIComponent(siteId)}/reports/${from}/${to}/funnels?${q.toString()}`;
}

export function geoCountriesPath(siteId: string, from: string, to: string): string {
  return `/v1/sites/${encodeURIComponent(siteId)}/reports/${from}/${to}/geo`;
}

export function isGeoCountryResponse(value: unknown): value is GeoCountryResponse {
  return (
    isRecord(value) &&
    isString(value.site_id) &&
    isString(value.from) &&
    isValidDate(value.from) &&
    isString(value.to) &&
    isValidDate(value.to) &&
    (value.coverage_from === null ||
      (isString(value.coverage_from) && isValidDate(value.coverage_from))) &&
    Array.isArray(value.providers) &&
    value.providers.every((provider) => provider === "db-ip" || provider === "maxmind") &&
    new Set(value.providers).size === value.providers.length &&
    isNullableDateTime(value.data_as_of) &&
    isFreshnessStatus(value.freshness_status) &&
    isPositiveInteger(value.aggregation_version) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        isString(item.country_code) &&
        (item.country_code === "unknown" || /^[A-Z]{2}$/.test(item.country_code)) &&
        isNonNegativeInteger(item.page_views),
    )
  );
}

export function visitorsPath(siteId: string, from: string, to: string): string {
  return `/v1/sites/${encodeURIComponent(siteId)}/reports/${from}/${to}/visitors`;
}

export function sessionsPath(siteId: string, from: string, to: string): string {
  return `/v1/sites/${encodeURIComponent(siteId)}/reports/${from}/${to}/sessions`;
}

export function dimensionPath(
  siteId: string,
  from: string,
  to: string,
  dimension: AnalyticsDimension,
  limit: number,
): string {
  return `/v1/sites/${encodeURIComponent(siteId)}/reports/${from}/${to}/dimensions/${dimension}?limit=${encodeURIComponent(String(limit))}`;
}

export function isOverviewResponse(value: unknown): value is OverviewResponse {
  return isRecord(value) && isString(value.site_id) && isNonNegativeInteger(value.page_views);
}

export function isRangeOverviewResponse(value: unknown): value is RangeOverviewResponse {
  return (
    isRecord(value) &&
    isString(value.site_id) &&
    isNonNegativeInteger(value.page_views) &&
    isString(value.from) &&
    isValidDate(value.from) &&
    isString(value.to) &&
    isValidDate(value.to)
  );
}

export function isTimelineResponse(value: unknown): value is TimelineResponse {
  return (
    isRecord(value) &&
    isString(value.site_id) &&
    isString(value.from) &&
    isValidDate(value.from) &&
    isString(value.to) &&
    isValidDate(value.to) &&
    Array.isArray(value.items) &&
    value.items.every(isTimelineItem)
  );
}

export function isPagesResponse(value: unknown): value is PagesResponse {
  return (
    isRecord(value) &&
    isString(value.site_id) &&
    isString(value.from) &&
    isValidDate(value.from) &&
    isString(value.to) &&
    isValidDate(value.to) &&
    Array.isArray(value.items) &&
    value.items.every(isPageItem)
  );
}

export function isEventsResponse(value: unknown): value is EventsResponse {
  return (
    isRecord(value) &&
    isString(value.site_id) &&
    isString(value.from) &&
    isValidDate(value.from) &&
    isString(value.to) &&
    isValidDate(value.to) &&
    isNonNegativeInteger(value.total) &&
    Array.isArray(value.items) &&
    value.items.every(isEventDailyItem) &&
    isNullableDateTime(value.data_as_of) &&
    isFreshnessStatus(value.freshness_status) &&
    isPositiveInteger(value.aggregation_version)
  );
}

export function isWebVitalsResponse(value: unknown): value is WebVitalsResponse {
  return (
    isRecord(value) &&
    isString(value.site_id) &&
    isString(value.from) &&
    isValidDate(value.from) &&
    isString(value.to) &&
    isValidDate(value.to) &&
    isNonNegativeInteger(value.total) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        isString(item.path) &&
        isString(item.metric) &&
        ["LCP", "INP", "CLS", "FCP", "TTFB"].includes(item.metric) &&
        isNonNegativeInteger(item.count) &&
        (item.p75 === null || typeof item.p75 === "number") &&
        isNonNegativeInteger(item.good_count) &&
        isNonNegativeInteger(item.needs_improvement_count) &&
        isNonNegativeInteger(item.poor_count) &&
        (item.status === "available" || item.status === "insufficient_data"),
    ) &&
    isNullableDateTime(value.data_as_of) &&
    isFreshnessStatus(value.freshness_status) &&
    isPositiveInteger(value.aggregation_version)
  );
}

export function isConversionReportResponse(value: unknown): value is ConversionReportResponse {
  return (
    isDefinitionReport(value) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        !("properties" in item) &&
        !("visitor_id" in item) &&
        isString(item.definition_id) &&
        isString(item.day) &&
        isValidDate(item.day) &&
        isNonNegativeInteger(item.event_count) &&
        isNonNegativeInteger(item.converted_sessions) &&
        isNonNegativeInteger(item.eligible_sessions) &&
        typeof item.conversion_rate === "number" &&
        item.conversion_rate >= 0 &&
        item.conversion_rate <= 1,
    )
  );
}

export function isFunnelReportResponse(value: unknown): value is FunnelReportResponse {
  return (
    isDefinitionReport(value) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        !("properties" in item) &&
        !("visitor_id" in item) &&
        isString(item.definition_id) &&
        isString(item.day) &&
        isValidDate(item.day) &&
        isNonNegativeInteger(item.step_index) &&
        isNonNegativeInteger(item.sessions) &&
        typeof item.conversion_rate === "number" &&
        item.conversion_rate >= 0 &&
        item.conversion_rate <= 1,
    )
  );
}

function isDefinitionReport(value: unknown): value is Record<string, unknown> & {
  site_id: string;
  from: string;
  to: string;
  total: number;
  definition_version: string;
  items: unknown[];
  data_as_of: string | null;
  freshness_status: FreshnessStatus;
  aggregation_version: number;
} {
  return (
    isRecord(value) &&
    isString(value.site_id) &&
    isString(value.from) &&
    isValidDate(value.from) &&
    isString(value.to) &&
    isValidDate(value.to) &&
    isNonNegativeInteger(value.total) &&
    isString(value.definition_version) &&
    Array.isArray(value.items) &&
    isNullableDateTime(value.data_as_of) &&
    isFreshnessStatus(value.freshness_status) &&
    isPositiveInteger(value.aggregation_version)
  );
}

export function isVisitorSessionResponse(value: unknown): value is VisitorSessionResponse {
  return (
    isRecord(value) &&
    isString(value.site_id) &&
    isString(value.from) &&
    isValidDate(value.from) &&
    isString(value.to) &&
    isValidDate(value.to) &&
    isNonNegativeInteger(value.page_views) &&
    isNonNegativeInteger(value.unique_visitors) &&
    isNonNegativeInteger(value.sessions) &&
    Array.isArray(value.items) &&
    value.items.every(isVisitorSessionItem) &&
    isNullableDateTime(value.data_as_of) &&
    isFreshnessStatus(value.freshness_status) &&
    isPositiveInteger(value.aggregation_version)
  );
}

export function isDimensionResponse(value: unknown): value is DimensionResponse {
  return (
    isRecord(value) &&
    isString(value.site_id) &&
    isString(value.from) &&
    isValidDate(value.from) &&
    isString(value.to) &&
    isValidDate(value.to) &&
    isDimension(value.dimension) &&
    Array.isArray(value.items) &&
    value.items.every(isDimensionItem) &&
    isNullableDateTime(value.data_as_of) &&
    isFreshnessStatus(value.freshness_status) &&
    isPositiveInteger(value.aggregation_version)
  );
}

export function isAnalyticsApiErrorResponse(value: unknown): value is AnalyticsApiErrorResponse {
  return (
    isRecord(value) &&
    isRecord(value.error) &&
    isString(value.error.code) &&
    isString(value.error.message)
  );
}

function isEventDailyItem(value: unknown): value is EventDailyItem {
  return (
    isRecord(value) &&
    isString(value.day) &&
    isValidDate(value.day) &&
    isString(value.event_name) &&
    value.event_name.length > 0 &&
    isNonNegativeInteger(value.event_count)
  );
}

function isTimelineItem(value: unknown): value is TimelineItem {
  return (
    isRecord(value) &&
    isString(value.day) &&
    isValidDate(value.day) &&
    isNonNegativeInteger(value.page_views)
  );
}

function isPageItem(value: unknown): value is PageItem {
  return (
    isRecord(value) &&
    isString(value.path) &&
    value.path.startsWith("/") &&
    isNonNegativeInteger(value.page_views)
  );
}

function isVisitorSessionItem(value: unknown): value is VisitorSessionResponse["items"][number] {
  return (
    isRecord(value) &&
    isString(value.day) &&
    isValidDate(value.day) &&
    isNonNegativeInteger(value.page_views) &&
    isNonNegativeInteger(value.unique_visitors) &&
    isNonNegativeInteger(value.sessions)
  );
}

function isDimensionItem(value: unknown): value is DimensionResponse["items"][number] {
  return (
    isRecord(value) &&
    isString(value.value) &&
    value.value.length > 0 &&
    isNonNegativeInteger(value.page_views) &&
    isNonNegativeInteger(value.unique_visitors) &&
    isNonNegativeInteger(value.sessions)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isDimension(value: unknown): value is AnalyticsDimension {
  return typeof value === "string" && (ANALYTICS_DIMENSIONS as readonly string[]).includes(value);
}

function isFreshnessStatus(value: unknown): value is FreshnessStatus {
  return value === "current" || value === "stale" || value === "rebuilding" || value === "failed";
}

function isNullableDateTime(value: unknown): value is string | null {
  return (
    value === null ||
    (isString(value) && RFC3339_UTC.test(value) && !Number.isNaN(Date.parse(value)))
  );
}

const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
