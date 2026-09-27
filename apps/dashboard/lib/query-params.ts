import { ANALYTICS_DIMENSIONS, type AnalyticsDimension } from "./analytics-api/types";

export interface DashboardDateRange {
  from: string;
  to: string;
}

export interface DashboardQueryParams {
  siteId: string;
  dateRange: DashboardDateRange;
  dimension: AnalyticsDimension;
  definitionVersion?: string;
}

export type DashboardQueryErrorCode =
  | "invalid_date"
  | "partial_date_range"
  | "reversed_date_range"
  | "unknown_site"
  | "invalid_dimension";

export interface DashboardQueryError {
  code: DashboardQueryErrorCode;
  message: string;
}

export type DashboardQueryResult =
  { params: DashboardQueryParams; error?: never } | { error: DashboardQueryError; params?: never };

export type DashboardSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function defaultDashboardDateRange(now: Date): DashboardDateRange {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);

  return { from: formatDate(from), to: formatDate(to) };
}

export function parseDashboardQuery(
  searchParams: DashboardSearchParams,
  defaultSite: string,
  allowedSites: readonly string[],
  now: Date = new Date(),
): DashboardQueryResult {
  const siteId = firstValue(searchParams.site_id) || defaultSite;
  const from = firstValue(searchParams.from);
  const to = firstValue(searchParams.to);
  const dimension = firstValue(searchParams.dimension) || "browser";
  const definitionVersion = firstValue(searchParams.definition_version);
  if (
    definitionVersion &&
    (definitionVersion.length > 64 ||
      definitionVersion.trim() !== definitionVersion ||
      /\s/.test(definitionVersion))
  )
    return {
      error: { code: "invalid_dimension", message: "The selected definition revision is invalid." },
    };

  if (!allowedSites.includes(siteId)) {
    return {
      error: {
        code: "unknown_site",
        message: "The selected site is not configured for this dashboard.",
      },
    };
  }

  if (!(ANALYTICS_DIMENSIONS as readonly string[]).includes(dimension)) {
    return {
      error: {
        code: "invalid_dimension",
        message: "The selected dimension is not supported.",
      },
    };
  }

  if (!from && !to) {
    return {
      params: {
        siteId,
        dateRange: defaultDashboardDateRange(now),
        dimension: dimension as AnalyticsDimension,
        ...(definitionVersion ? { definitionVersion } : {}),
      },
    };
  }

  if (!from || !to) {
    return {
      error: {
        code: "partial_date_range",
        message: "Both from and to dates are required.",
      },
    };
  }

  const fromDate = parseDate(from);
  const toDate = parseDate(to);

  if (!fromDate || !toDate) {
    return {
      error: {
        code: "invalid_date",
        message: "Dates must use the YYYY-MM-DD format and be valid calendar dates.",
      },
    };
  }

  if (fromDate > toDate) {
    return {
      error: {
        code: "reversed_date_range",
        message: "The from date must be on or before the to date.",
      },
    };
  }

  return {
    params: {
      siteId,
      dateRange: { from, to },
      dimension: dimension as AnalyticsDimension,
      ...(definitionVersion ? { definitionVersion } : {}),
    },
  };
}
