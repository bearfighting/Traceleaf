import { WEB_VITAL_METRICS, WEB_VITAL_RATING_THRESHOLDS } from "@web-analytics/protocol-ts";
import { describe, expect, it } from "vitest";

import { buildWebVitalsChartData, getWebVitalsChartHeight } from "./web-vitals-chart-data";

import type { WebVitalsResponse } from "../../lib/analytics/analytics-api/types";

const items: WebVitalsResponse["items"] = [
  {
    path: "/long-route-name-first",
    metric: "LCP",
    count: 4,
    p75: null,
    good_count: 2,
    needs_improvement_count: 1,
    poor_count: 1,
    status: "insufficient_data",
  },
  {
    path: "/second",
    metric: "LCP",
    count: 5,
    p75: 2600,
    good_count: 1,
    needs_improvement_count: 3,
    poor_count: 1,
    status: "available",
  },
  {
    path: "/interaction",
    metric: "INP",
    count: 3,
    p75: 180,
    good_count: 2,
    needs_improvement_count: 1,
    poor_count: 0,
    status: "available",
  },
  {
    path: "/layout",
    metric: "CLS",
    count: 3,
    p75: 0.12,
    good_count: 2,
    needs_improvement_count: 1,
    poor_count: 0,
    status: "available",
  },
  {
    path: "/paint",
    metric: "FCP",
    count: 3,
    p75: 1700,
    good_count: 3,
    needs_improvement_count: 0,
    poor_count: 0,
    status: "available",
  },
  {
    path: "/server",
    metric: "TTFB",
    count: 3,
    p75: 900,
    good_count: 1,
    needs_improvement_count: 1,
    poor_count: 1,
    status: "available",
  },
];

describe("buildWebVitalsChartData", () => {
  it("preserves metric and API route order with original rating counts", () => {
    expect(WEB_VITAL_METRICS).toEqual(["LCP", "INP", "CLS", "FCP", "TTFB"]);

    const lcp = buildWebVitalsChartData(items, "LCP");
    expect(lcp.items.map((item) => item.path)).toEqual(["/long-route-name-first", "/second"]);
    expect(
      lcp.items.map(({ good_count, needs_improvement_count, poor_count }) => [
        good_count,
        needs_improvement_count,
        poor_count,
      ]),
    ).toEqual([
      [2, 1, 1],
      [1, 3, 1],
    ]);
  });

  it("only includes available p75 values and returns shared threshold markers", () => {
    const lcp = buildWebVitalsChartData(items, "LCP");
    expect(lcp.p75Items.map(({ path, p75 }) => [path, p75])).toEqual([["/second", 2600]]);
    expect(lcp.thresholds).toBe(WEB_VITAL_RATING_THRESHOLDS.LCP);

    const cls = buildWebVitalsChartData(items, "CLS");
    expect(cls.p75Items[0]?.p75).toBe(0.12);
    expect(cls.thresholds).toBe(WEB_VITAL_RATING_THRESHOLDS.CLS);
  });

  it("handles a metric with no returned routes", () => {
    expect(buildWebVitalsChartData([], "TTFB")).toEqual({
      items: [],
      p75Items: [],
      thresholds: WEB_VITAL_RATING_THRESHOLDS.TTFB,
    });
  });

  it("allocates enough chart height for every API route", () => {
    expect(getWebVitalsChartHeight(1)).toBe(220);
    expect(getWebVitalsChartHeight(20)).toBe(700);
  });
});
