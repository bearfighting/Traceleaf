import { createAnalyticsApiClient } from "./analytics-api/client";
import { getAnalyticsApiUrl } from "./analytics-api/config";
import { AnalyticsApiClientError } from "./analytics-api/errors";

import type { AnalyticsApiClient } from "./analytics-api/client";
import type {
  AnalyticsDimension,
  DimensionResponse,
  EventsResponse,
  PagesResponse,
  TimelineResponse,
  VisitorSessionResponse,
  WebVitalsResponse,
  ConversionReportResponse,
  FunnelReportResponse,
  GeoCountryResponse,
} from "./analytics-api/types";
import type { DashboardApiDependencies } from "./dashboard-dependencies";
import type { DashboardOverviewContext } from "./dashboard-overview";

export type DashboardReportState<T> =
  | { status: "success"; data: T }
  | { status: "error"; error: AnalyticsApiClientError }
  | { status: "disabled"; error: AnalyticsApiClientError };

export interface DashboardReportsState {
  events: DashboardReportState<EventsResponse>;
  geoCountries: DashboardReportState<GeoCountryResponse>;
  webVitals: DashboardReportState<WebVitalsResponse>;
  conversions: DashboardReportState<ConversionReportResponse>;
  funnels: DashboardReportState<FunnelReportResponse>;
  timeline: DashboardReportState<TimelineResponse>;
  pages: DashboardReportState<PagesResponse>;
  visitors: DashboardReportState<VisitorSessionResponse>;
  dimension: DashboardReportState<DimensionResponse>;
}

export interface DashboardLegacyReportsState {
  events: DashboardReportState<EventsResponse>;
  geoCountries: DashboardReportState<GeoCountryResponse>;
  webVitals: DashboardReportState<WebVitalsResponse>;
  conversions: DashboardReportState<ConversionReportResponse>;
  funnels: DashboardReportState<FunnelReportResponse>;
  timeline: DashboardReportState<TimelineResponse>;
  pages: DashboardReportState<PagesResponse>;
}

export interface DashboardPhase6ReportsState {
  visitors: DashboardReportState<VisitorSessionResponse>;
  dimension: DashboardReportState<DimensionResponse>;
}

export async function loadDashboardLegacyReports(
  context: DashboardOverviewContext,
  dependencies: DashboardApiDependencies = {},
): Promise<DashboardLegacyReportsState> {
  let client: AnalyticsApiClient;

  try {
    client = resolveClient(dependencies);
  } catch (cause) {
    const error = toAnalyticsApiClientError(cause);

    return {
      timeline: { status: "error", error },
      pages: { status: "error", error },
      events: { status: "error", error },
      geoCountries: { status: "error", error },
      webVitals: { status: "error", error },
      conversions: { status: "error", error },
      funnels: { status: "error", error },
    };
  }

  const [timeline, pages, events, geoCountries, webVitals, conversions, funnels] =
    await Promise.all([
      settle(() => client.timeline(context.siteId, context.dateRange.from, context.dateRange.to)),
      settle(() => client.pages(context.siteId, context.dateRange.from, context.dateRange.to)),
      settle(() =>
        client.events(context.siteId, context.dateRange.from, context.dateRange.to, 100),
      ),
      settle(() =>
        client.geoCountries(context.siteId, context.dateRange.from, context.dateRange.to),
      ),
      settle(() => loadWebVitals(client, context)),
      settle(() => loadConversions(client, context)),
      settle(() => loadFunnels(client, context)),
    ]);

  return { timeline, pages, events, geoCountries, webVitals, conversions, funnels };
}

export async function loadDashboardPhase6Reports(
  context: DashboardOverviewContext,
  dependencies: DashboardApiDependencies = {},
  dimension: AnalyticsDimension = context.dimension ?? "browser",
): Promise<DashboardPhase6ReportsState> {
  let client: AnalyticsApiClient;

  try {
    client = resolveClient(dependencies);
  } catch (cause) {
    const error = toAnalyticsApiClientError(cause);

    return {
      visitors: { status: "error", error },
      dimension: { status: "error", error },
    };
  }

  const [visitors, dimensionReport] = await Promise.all([
    settlePhase6(() =>
      client.visitors(context.siteId, context.dateRange.from, context.dateRange.to),
    ),
    settlePhase6(() =>
      client.dimension(context.siteId, context.dateRange.from, context.dateRange.to, dimension),
    ),
  ]);

  return { visitors, dimension: dimensionReport };
}

export async function loadDashboardReports(
  context: DashboardOverviewContext,
  dependencies: DashboardApiDependencies = {},
  dimension: AnalyticsDimension = context.dimension ?? "browser",
): Promise<DashboardReportsState> {
  let client: AnalyticsApiClient;

  try {
    client =
      dependencies.client ??
      (dependencies.createClient ?? createAnalyticsApiClient)({
        baseUrl: (dependencies.getApiUrl ?? getAnalyticsApiUrl)(),
      });
  } catch (cause) {
    const error = toAnalyticsApiClientError(cause);

    return {
      timeline: { status: "error", error },
      pages: { status: "error", error },
      events: { status: "error", error },
      geoCountries: { status: "error", error },
      webVitals: { status: "error", error },
      conversions: { status: "error", error },
      funnels: { status: "error", error },
      visitors: { status: "error", error },
      dimension: { status: "error", error },
    };
  }

  const [
    timeline,
    pages,
    events,
    geoCountries,
    webVitals,
    conversions,
    funnels,
    visitors,
    dimensionReport,
  ] = await Promise.all([
    settle(() => client.timeline(context.siteId, context.dateRange.from, context.dateRange.to)),
    settle(() => client.pages(context.siteId, context.dateRange.from, context.dateRange.to)),
    settle(() => client.events(context.siteId, context.dateRange.from, context.dateRange.to, 100)),
    settle(() => client.geoCountries(context.siteId, context.dateRange.from, context.dateRange.to)),
    settle(() => loadWebVitals(client, context)),
    settle(() => loadConversions(client, context)),
    settle(() => loadFunnels(client, context)),
    settlePhase6(() =>
      client.visitors(context.siteId, context.dateRange.from, context.dateRange.to),
    ),
    settlePhase6(() =>
      client.dimension(context.siteId, context.dateRange.from, context.dateRange.to, dimension),
    ),
  ]);

  return {
    timeline,
    pages,
    events,
    geoCountries,
    webVitals,
    conversions,
    funnels,
    visitors,
    dimension: dimensionReport,
  };
}

function loadWebVitals(
  client: AnalyticsApiClient,
  context: DashboardOverviewContext,
): Promise<WebVitalsResponse> {
  return client.webVitals
    ? client.webVitals(context.siteId, context.dateRange.from, context.dateRange.to)
    : Promise.resolve({
        site_id: context.siteId,
        from: context.dateRange.from,
        to: context.dateRange.to,
        total: 0,
        items: [],
        data_as_of: null,
        freshness_status: "current",
        aggregation_version: 1,
      });
}

function loadConversions(
  client: AnalyticsApiClient,
  context: DashboardOverviewContext,
): Promise<ConversionReportResponse> {
  return client.conversions
    ? client.conversions(
        context.siteId,
        context.dateRange.from,
        context.dateRange.to,
        20,
        undefined,
        context.definitionVersion,
      )
    : Promise.resolve({
        site_id: context.siteId,
        from: context.dateRange.from,
        to: context.dateRange.to,
        total: 0,
        definition_version: "1",
        items: [],
        data_as_of: null,
        freshness_status: "current",
        aggregation_version: 1,
      });
}

function loadFunnels(
  client: AnalyticsApiClient,
  context: DashboardOverviewContext,
): Promise<FunnelReportResponse> {
  return client.funnels
    ? client.funnels(
        context.siteId,
        context.dateRange.from,
        context.dateRange.to,
        20,
        undefined,
        context.definitionVersion,
      )
    : Promise.resolve({
        site_id: context.siteId,
        from: context.dateRange.from,
        to: context.dateRange.to,
        total: 0,
        definition_version: "1",
        items: [],
        data_as_of: null,
        freshness_status: "current",
        aggregation_version: 1,
      });
}

function resolveClient(dependencies: DashboardApiDependencies): AnalyticsApiClient {
  return (
    dependencies.client ??
    (dependencies.createClient ?? createAnalyticsApiClient)({
      baseUrl: (dependencies.getApiUrl ?? getAnalyticsApiUrl)(),
    })
  );
}

async function settle<T>(request: () => Promise<T>): Promise<DashboardReportState<T>> {
  try {
    return { status: "success", data: await request() };
  } catch (cause) {
    return { status: "error", error: toAnalyticsApiClientError(cause) };
  }
}

async function settlePhase6<T>(request: () => Promise<T>): Promise<DashboardReportState<T>> {
  try {
    return { status: "success", data: await request() };
  } catch (cause) {
    const error = toAnalyticsApiClientError(cause);

    return error.kind === "disabled" ? { status: "disabled", error } : { status: "error", error };
  }
}

function toAnalyticsApiClientError(cause: unknown): AnalyticsApiClientError {
  if (cause instanceof AnalyticsApiClientError) {
    return cause;
  }

  return new AnalyticsApiClientError("Dashboard report could not be loaded.", {
    kind: "network",
    cause,
  });
}
