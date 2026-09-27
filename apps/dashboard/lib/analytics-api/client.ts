import { AnalyticsApiClientError } from "./errors";
import {
  DEFAULT_PAGES_LIMIT,
  dimensionPath,
  eventsPath,
  isEventsResponse,
  conversionsPath,
  funnelsPath,
  isConversionReportResponse,
  isFunnelReportResponse,
  geoCountriesPath,
  isGeoCountryResponse,
  isDimensionResponse,
  isAnalyticsApiErrorResponse,
  isOverviewResponse,
  isPagesResponse,
  isRangeOverviewResponse,
  isTimelineResponse,
  isVisitorSessionResponse,
  overviewPath,
  pagesPath,
  rangeOverviewPath,
  sessionsPath,
  timelinePath,
  visitorsPath,
  webVitalsPath,
  isWebVitalsResponse,
  type ResponseValidator,
} from "./queries";

import type {
  OverviewResponse,
  EventsResponse,
  PagesResponse,
  RangeOverviewResponse,
  TimelineResponse,
  AnalyticsDimension,
  DimensionResponse,
  VisitorSessionResponse,
  WebVitalsResponse,
  ConversionReportResponse,
  FunnelReportResponse,
  GeoCountryResponse,
} from "./types";

export interface AnalyticsApiClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export interface AnalyticsApiClient {
  overview(siteId: string): Promise<OverviewResponse>;
  rangeOverview(siteId: string, from: string, to: string): Promise<RangeOverviewResponse>;
  timeline(siteId: string, from: string, to: string): Promise<TimelineResponse>;
  pages(siteId: string, from: string, to: string, limit?: number): Promise<PagesResponse>;
  events(
    siteId: string,
    from: string,
    to: string,
    limit?: number,
    eventName?: string,
  ): Promise<EventsResponse>;
  conversions?(
    siteId: string,
    from: string,
    to: string,
    limit?: number,
    definitionId?: string,
    definitionVersion?: string,
  ): Promise<ConversionReportResponse>;
  funnels?(
    siteId: string,
    from: string,
    to: string,
    limit?: number,
    definitionId?: string,
    definitionVersion?: string,
  ): Promise<FunnelReportResponse>;
  webVitals?(
    siteId: string,
    from: string,
    to: string,
    limit?: number,
    path?: string,
  ): Promise<WebVitalsResponse>;
  geoCountries(siteId: string, from: string, to: string): Promise<GeoCountryResponse>;
  visitors(siteId: string, from: string, to: string): Promise<VisitorSessionResponse>;
  sessions(siteId: string, from: string, to: string): Promise<VisitorSessionResponse>;
  dimension(
    siteId: string,
    from: string,
    to: string,
    dimension: AnalyticsDimension,
    limit?: number,
  ): Promise<DimensionResponse>;
}

const HTTP_ERROR_MESSAGE = "Analytics API failed to complete the request";
const RESPONSE_ERROR_MESSAGE = "Analytics API returned an invalid response";

export function createAnalyticsApiClient(options: AnalyticsApiClientOptions): AnalyticsApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const injectedFetch = options.fetch ?? globalThis.fetch;

  return {
    overview: (siteId) => requestJson(`${baseUrl}${overviewPath(siteId)}`, isOverviewResponse),
    rangeOverview: (siteId, from, to) =>
      requestJson(`${baseUrl}${rangeOverviewPath(siteId, from, to)}`, isRangeOverviewResponse),
    timeline: (siteId, from, to) =>
      requestJson(`${baseUrl}${timelinePath(siteId, from, to)}`, isTimelineResponse),
    pages: (siteId, from, to, limit = DEFAULT_PAGES_LIMIT) =>
      requestJson(`${baseUrl}${pagesPath(siteId, from, to, limit)}`, isPagesResponse),
    events: (siteId, from, to, limit = 100, eventName) =>
      requestJson(
        `${baseUrl}${eventsPath(siteId, from, to, limit, eventName)}`,
        (value): value is EventsResponse =>
          isEventsResponse(value) && matchesRange(value, siteId, from, to),
      ),
    conversions: (siteId, from, to, limit = 20, definitionId, definitionVersion) =>
      requestJson(
        `${baseUrl}${conversionsPath(siteId, from, to, limit, definitionId, definitionVersion)}`,
        (v): v is ConversionReportResponse =>
          isConversionReportResponse(v) && matchesRange(v, siteId, from, to),
      ),
    funnels: (siteId, from, to, limit = 20, definitionId, definitionVersion) =>
      requestJson(
        `${baseUrl}${funnelsPath(siteId, from, to, limit, definitionId, definitionVersion)}`,
        (v): v is FunnelReportResponse =>
          isFunnelReportResponse(v) && matchesRange(v, siteId, from, to),
      ),
    webVitals: (siteId, from, to, limit = 20, path) =>
      requestJson(
        `${baseUrl}${webVitalsPath(siteId, from, to, limit, path)}`,
        (v): v is WebVitalsResponse => isWebVitalsResponse(v) && matchesRange(v, siteId, from, to),
      ),
    geoCountries: (siteId, from, to) =>
      requestJson(
        `${baseUrl}${geoCountriesPath(siteId, from, to)}`,
        (value): value is GeoCountryResponse =>
          isGeoCountryResponse(value) && matchesRange(value, siteId, from, to),
      ),
    visitors: (siteId, from, to) =>
      requestJson(
        `${baseUrl}${visitorsPath(siteId, from, to)}`,
        (value): value is VisitorSessionResponse =>
          isVisitorSessionResponse(value) && matchesRange(value, siteId, from, to),
      ),
    sessions: (siteId, from, to) =>
      requestJson(
        `${baseUrl}${sessionsPath(siteId, from, to)}`,
        (value): value is VisitorSessionResponse =>
          isVisitorSessionResponse(value) && matchesRange(value, siteId, from, to),
      ),
    dimension: (siteId, from, to, dimension, limit = DEFAULT_PAGES_LIMIT) =>
      requestJson(
        `${baseUrl}${dimensionPath(siteId, from, to, dimension, limit)}`,
        (value): value is DimensionResponse =>
          isDimensionResponse(value) &&
          matchesRange(value, siteId, from, to) &&
          value.dimension === dimension,
      ),
  };

  async function requestJson<T>(url: string, validate: ResponseValidator<T>): Promise<T> {
    let response: Response;

    try {
      response = await injectedFetch(url, {
        method: "GET",
        cache: "no-store",
      });
    } catch (cause) {
      throw new AnalyticsApiClientError("Analytics API request failed.", {
        kind: "network",
        cause,
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      if (!response.ok) {
        throw new AnalyticsApiClientError(HTTP_ERROR_MESSAGE, {
          kind: "http",
          status: response.status,
          cause,
        });
      }

      throw new AnalyticsApiClientError(RESPONSE_ERROR_MESSAGE, {
        kind: "response",
        status: response.status,
        cause,
      });
    }

    if (!response.ok) {
      if (isAnalyticsApiErrorResponse(body)) {
        throw new AnalyticsApiClientError(body.error.message, {
          kind: body.error.code === "analytics_not_enabled" ? "disabled" : "http",
          status: response.status,
          code: body.error.code,
        });
      }

      throw new AnalyticsApiClientError(HTTP_ERROR_MESSAGE, {
        kind: "http",
        status: response.status,
      });
    }

    if (!validate(body)) {
      throw new AnalyticsApiClientError(RESPONSE_ERROR_MESSAGE, {
        kind: "response",
        status: response.status,
      });
    }

    return body;
  }
}

function matchesRange(
  value: { site_id: string; from: string; to: string },
  siteId: string,
  from: string,
  to: string,
): boolean {
  return value.site_id === siteId && value.from === from && value.to === to;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch (cause) {
    throw new AnalyticsApiClientError("Analytics API baseUrl must be an absolute HTTP(S) URL.", {
      kind: "config",
      cause,
    });
  }

  if (!/^https?:$/.test(url.protocol) || url.search || url.hash) {
    throw new AnalyticsApiClientError("Analytics API baseUrl must be an absolute HTTP(S) URL.", {
      kind: "config",
    });
  }

  return url.toString().replace(/\/+$/, "");
}
