import { WEB_VITAL_RATING_THRESHOLDS } from "@web-analytics/protocol-ts";

import type { WebVitalsResponse } from "../../lib/analytics/analytics-api/types";
import type { WebVitalMetric } from "@web-analytics/protocol-ts";

export interface WebVitalsChartData {
  items: WebVitalsResponse["items"];
  p75Items: Array<WebVitalsResponse["items"][number] & { p75: number }>;
  thresholds: (typeof WEB_VITAL_RATING_THRESHOLDS)[WebVitalMetric];
}

export function getWebVitalsChartHeight(routeCount: number): number {
  return Math.max(220, routeCount * 32 + 60);
}

export function buildWebVitalsChartData(
  items: WebVitalsResponse["items"],
  metric: WebVitalMetric,
): WebVitalsChartData {
  const metricItems = items.filter((item) => item.metric === metric);

  return {
    items: metricItems,
    p75Items: metricItems.filter(
      (item): item is (typeof metricItems)[number] & { p75: number } =>
        item.status === "available" && item.p75 !== null,
    ),
    thresholds: WEB_VITAL_RATING_THRESHOLDS[metric],
  };
}
