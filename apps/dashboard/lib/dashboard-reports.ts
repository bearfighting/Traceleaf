import { createAnalyticsApiClient } from "./analytics-api/client";
import { getAnalyticsApiUrl } from "./analytics-api/config";
import { AnalyticsApiClientError } from "./analytics-api/errors";
import { loadDefinitionRevisionHistory } from "./definition-revision-history";

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
  | { status: "disabled"; error: AnalyticsApiClientError }
  | { status: "unavailable"; error: AnalyticsApiClientError };
export type DashboardDefinitionReportState<T> =
  DashboardReportState<T> | { status: "missing_definitions" };

export interface DashboardReportsState {
  events: DashboardReportState<EventsResponse>;
  geoCountries: DashboardReportState<GeoCountryResponse>;
  webVitals: DashboardReportState<WebVitalsResponse>;
  conversions: DashboardDefinitionReportState<ConversionReportResponse>;
  funnels: DashboardDefinitionReportState<FunnelReportResponse>;
  timeline: DashboardReportState<TimelineResponse>;
  pages: DashboardReportState<PagesResponse>;
  visitors: DashboardReportState<VisitorSessionResponse>;
  dimension: DashboardReportState<DimensionResponse>;
}

export interface DashboardTrafficAndOutcomeReportsState {
  events: DashboardReportState<EventsResponse>;
  geoCountries: DashboardReportState<GeoCountryResponse>;
  webVitals: DashboardReportState<WebVitalsResponse>;
  conversions: DashboardDefinitionReportState<ConversionReportResponse>;
  funnels: DashboardDefinitionReportState<FunnelReportResponse>;
  timeline: DashboardReportState<TimelineResponse>;
  pages: DashboardReportState<PagesResponse>;
}

export interface DashboardAudienceDimensionReportsState {
  visitors: DashboardReportState<VisitorSessionResponse>;
  dimension: DashboardReportState<DimensionResponse>;
}

export type AudienceDimensionReportName = "overview" | "visitors" | "sessions" | "dimensions";

export type AudienceDimensionReportResult =
  | { kind: "audience"; state: DashboardReportState<VisitorSessionResponse> }
  | { kind: "dimension"; state: DashboardReportState<DimensionResponse> };

export async function loadTrafficAndOutcomeReports(
  context: DashboardOverviewContext,
  dependencies: DashboardApiDependencies = {},
): Promise<DashboardTrafficAndOutcomeReportsState> {
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
      settleDefinitionReport(() => loadConversions(client, context), context),
      settleDefinitionReport(() => loadFunnels(client, context), context),
    ]);

  return { timeline, pages, events, geoCountries, webVitals, conversions, funnels };
}

export async function loadAudienceDimensionReports(
  context: DashboardOverviewContext,
  dependencies: DashboardApiDependencies = {},
  dimension: AnalyticsDimension = context.dimension ?? "browser",
): Promise<DashboardAudienceDimensionReportsState> {
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
    settleReportRequest(() =>
      client.visitors(context.siteId, context.dateRange.from, context.dateRange.to),
    ),
    settleReportRequest(() =>
      client.dimension(context.siteId, context.dateRange.from, context.dateRange.to, dimension),
    ),
  ]);

  return { visitors, dimension: dimensionReport };
}

export async function loadAudienceDimensionReport(
  context: DashboardOverviewContext,
  report: AudienceDimensionReportName,
  dependencies: DashboardApiDependencies = {},
  dimension: AnalyticsDimension = context.dimension ?? "browser",
): Promise<AudienceDimensionReportResult> {
  let client: AnalyticsApiClient;
  try {
    client = resolveClient(dependencies);
  } catch (cause) {
    const error = toAnalyticsApiClientError(cause);

    return report === "dimensions"
      ? { kind: "dimension", state: { status: "error", error } }
      : { kind: "audience", state: { status: "error", error } };
  }

  if (report === "dimensions") {
    return {
      kind: "dimension",
      state: await settleReportRequest(() =>
        client.dimension(context.siteId, context.dateRange.from, context.dateRange.to, dimension),
      ),
    };
  }

  const query = report === "sessions" ? client.sessions : client.visitors;

  return {
    kind: "audience",
    state: await settleReportRequest(() =>
      query(context.siteId, context.dateRange.from, context.dateRange.to),
    ),
  };
}

export async function loadTrafficAndOutcomeReport(
  context: DashboardOverviewContext,
  report: "pages" | "custom-events" | "countries" | "web-vitals" | "conversions" | "funnels",
  client: AnalyticsApiClient,
): Promise<Partial<DashboardTrafficAndOutcomeReportsState>> {
  switch (report) {
    case "pages": {
      const [timeline, pages] = await Promise.all([
        settle(() => client.timeline(context.siteId, context.dateRange.from, context.dateRange.to)),
        settle(() => client.pages(context.siteId, context.dateRange.from, context.dateRange.to)),
      ]);

      return { timeline, pages };
    }
    case "custom-events":
      return {
        events: await settle(() =>
          client.events(context.siteId, context.dateRange.from, context.dateRange.to, 100),
        ),
      };
    case "countries":
      return {
        geoCountries: await settle(() =>
          client.geoCountries(context.siteId, context.dateRange.from, context.dateRange.to),
        ),
      };
    case "web-vitals":
      return { webVitals: await settle(() => loadWebVitals(client, context)) };
    case "conversions":
      return {
        conversions: await settleDefinitionReport(() => loadConversions(client, context), context),
      };
    case "funnels":
      return { funnels: await settleDefinitionReport(() => loadFunnels(client, context), context) };
  }
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
    settleDefinitionReport(() => loadConversions(client, context), context),
    settleDefinitionReport(() => loadFunnels(client, context), context),
    settleReportRequest(() =>
      client.visitors(context.siteId, context.dateRange.from, context.dateRange.to),
    ),
    settleReportRequest(() =>
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
    : Promise.reject(unavailableEndpointError("Web Vitals"));
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
    : Promise.reject(unavailableEndpointError("Conversions"));
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
    : Promise.reject(unavailableEndpointError("Funnels"));
}

function unavailableEndpointError(report: string): AnalyticsApiClientError {
  return new AnalyticsApiClientError(
    `${report} report is not available in this Analytics API client.`,
    {
      kind: "unavailable",
    },
  );
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
    const error = toAnalyticsApiClientError(cause);

    return error.kind === "disabled"
      ? { status: "disabled", error }
      : error.kind === "unavailable"
        ? { status: "unavailable", error }
        : { status: "error", error };
  }
}

async function settleDefinitionReport<T>(
  request: () => Promise<T>,
  context: DashboardOverviewContext,
): Promise<DashboardDefinitionReportState<T>> {
  const state = await settle(request);
  if (state.status !== "success") {
    if (state.status !== "error" || state.error.code !== "invalid_definition_version") return state;
    const history = await loadDefinitionRevisionHistory(context.siteId);
    if (history.kind === "error") {
      return {
        status: "error",
        error: new AnalyticsApiClientError(history.message, { kind: "response" }),
      };
    }

    return history.revisions.length === 0 ? { status: "missing_definitions" } : state;
  }
  const history = await loadDefinitionRevisionHistory(context.siteId);
  if (history.kind === "error") {
    return {
      status: "error",
      error: new AnalyticsApiClientError(history.message, { kind: "response" }),
    };
  }

  return history.revisions.length === 0 ? { status: "missing_definitions" } : state;
}

async function settleReportRequest<T>(request: () => Promise<T>): Promise<DashboardReportState<T>> {
  try {
    return { status: "success", data: await request() };
  } catch (cause) {
    const error = toAnalyticsApiClientError(cause);

    return error.kind === "disabled"
      ? { status: "disabled", error }
      : error.kind === "unavailable"
        ? { status: "unavailable", error }
        : { status: "error", error };
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
