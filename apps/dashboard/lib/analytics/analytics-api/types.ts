export interface OverviewResponse {
  site_id: string;
  page_views: number;
}

export interface RangeOverviewResponse extends OverviewResponse {
  from: string;
  to: string;
}

export interface TimelineItem {
  day: string;
  page_views: number;
}

export interface TimelineResponse {
  site_id: string;
  from: string;
  to: string;
  items: TimelineItem[];
}

export interface PageItem {
  path: string;
  page_views: number;
}

export interface PagesResponse {
  site_id: string;
  from: string;
  to: string;
  items: PageItem[];
}

export const ANALYTICS_DIMENSIONS = [
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
] as const;

export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number];
export type FreshnessStatus = "current" | "stale" | "rebuilding" | "failed";

export interface VisitorSessionItem {
  day: string;
  page_views: number;
  unique_visitors: number;
  sessions: number;
}

export interface VisitorSessionResponse {
  site_id: string;
  from: string;
  to: string;
  page_views: number;
  unique_visitors: number;
  sessions: number;
  items: VisitorSessionItem[];
  data_as_of: string | null;
  freshness_status: FreshnessStatus;
  aggregation_version: number;
}

export interface DimensionItem {
  value: string;
  page_views: number;
  unique_visitors: number;
  sessions: number;
}

export interface DimensionResponse {
  site_id: string;
  from: string;
  to: string;
  dimension: AnalyticsDimension;
  items: DimensionItem[];
  data_as_of: string | null;
  freshness_status: FreshnessStatus;
  aggregation_version: number;
}

export interface AnalyticsApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export interface EventDailyItem {
  day: string;
  event_name: string;
  event_count: number;
}

export interface EventsResponse {
  site_id: string;
  from: string;
  to: string;
  total: number;
  items: EventDailyItem[];
  data_as_of: string | null;
  freshness_status: FreshnessStatus;
  aggregation_version: number;
}

export interface WebVitalReportItem {
  path: string;
  metric: "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
  count: number;
  p75: number | null;
  good_count: number;
  needs_improvement_count: number;
  poor_count: number;
  status: "available" | "insufficient_data";
}
export interface WebVitalsResponse {
  site_id: string;
  from: string;
  to: string;
  total: number;
  items: WebVitalReportItem[];
  data_as_of: string | null;
  freshness_status: FreshnessStatus;
  aggregation_version: number;
}

export interface ConversionReportItem {
  definition_id: string;
  day: string;
  event_count: number;
  converted_sessions: number;
  eligible_sessions: number;
  conversion_rate: number;
}
export interface ConversionReportResponse {
  site_id: string;
  from: string;
  to: string;
  total: number;
  definition_version: string;
  items: ConversionReportItem[];
  data_as_of: string | null;
  freshness_status: FreshnessStatus;
  aggregation_version: number;
}
export interface FunnelReportItem {
  definition_id: string;
  day: string;
  step_index: number;
  sessions: number;
  conversion_rate: number;
}
export interface FunnelReportResponse {
  site_id: string;
  from: string;
  to: string;
  total: number;
  definition_version: string;
  items: FunnelReportItem[];
  data_as_of: string | null;
  freshness_status: FreshnessStatus;
  aggregation_version: number;
}

export interface GeoCountryItem {
  country_code: string;
  page_views: number;
}

export interface GeoCountryResponse {
  site_id: string;
  from: string;
  to: string;
  coverage_from: string | null;
  providers: string[];
  items: GeoCountryItem[];
  data_as_of: string | null;
  freshness_status: FreshnessStatus;
  aggregation_version: number;
}
