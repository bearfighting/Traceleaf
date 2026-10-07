import type {
  AnalyticsApiClient,
  AnalyticsApiClientOptions,
} from "./analytics/analytics-api/client";

export interface DashboardApiDependencies {
  client?: AnalyticsApiClient;
  getApiUrl?: () => string;
  createClient?: (options: AnalyticsApiClientOptions) => AnalyticsApiClient;
}
