import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DimensionPageViewsChart,
  formatDimensionAxisLabel,
  formatDimensionTooltipLabel,
} from "./dimension-page-views-chart";
import { GeoCountryPageViewsChart } from "./geo-country-page-views-chart";

vi.mock("recharts", async () => {
  const ReactModule = await import("react");

  return {
    Bar: ({ dataKey }: { dataKey: string }) =>
      ReactModule.createElement("span", { "data-bar-key": dataKey }),
    BarChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) =>
      ReactModule.createElement("div", { "data-chart-points": JSON.stringify(data) }, children),
    XAxis: () => null,
    YAxis: () => null,
  };
});

vi.mock("../ui/chart", async () => {
  const ReactModule = await import("react");

  return {
    ChartContainer: ({ children, ...props }: React.ComponentProps<"div"> & { config: unknown }) =>
      ReactModule.createElement("div", props, children),
    ChartGrid: () => null,
    ChartTooltip: () => null,
    ChartTooltipContent: () => null,
  };
});

describe("distribution charts", () => {
  it("plots all dimension values in API order using Page Views, including zero values", () => {
    const items = [
      {
        value: "a very long dimension value that should remain complete",
        page_views: 0,
        unique_visitors: 0,
        sessions: 0,
      },
      { value: "Firefox", page_views: 7, unique_visitors: 3, sessions: 4 },
    ];
    const markup = renderToStaticMarkup(
      <DimensionPageViewsChart dimension="browser" items={items} />,
    );
    const encodedPoints = markup.match(/data-chart-points="([^"]+)"/)?.[1];

    expect(markup).toContain('data-bar-key="page_views"');
    expect(JSON.parse(encodedPoints!.replaceAll("&quot;", '"'))).toEqual(items);
    expect(markup).toContain("Page Views by browser");
  });

  it("truncates long dimension axis labels while keeping tooltip labels complete", () => {
    const value = "a very long dimension value that should remain complete";

    expect(formatDimensionAxisLabel(value)).toBe("a very long dimen…");
    expect(formatDimensionTooltipLabel(value)).toBe(value);
    expect(formatDimensionAxisLabel("Firefox")).toBe("Firefox");
  });

  it("plots the first ten API-ranked countries and retains Unknown only when it ranks there", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      country_code: index === 9 ? "unknown" : `C${index}`,
      page_views: 12 - index,
    }));
    const markup = renderToStaticMarkup(<GeoCountryPageViewsChart items={items} />);
    const encodedPoints = markup.match(/data-chart-points="([^"]+)"/)?.[1];
    const points = JSON.parse(encodedPoints!.replaceAll("&quot;", '"')) as typeof items;

    expect(points).toEqual(items.slice(0, 10));
    expect(markup).toContain("first 10 countries returned by the API");

    const beyondTopTen = renderToStaticMarkup(
      <GeoCountryPageViewsChart
        items={[
          ...items.slice(0, 10).filter((item) => item.country_code !== "unknown"),
          items[10],
          { country_code: "unknown", page_views: 0 },
        ]}
      />,
    );
    const topPointsEncoded = beyondTopTen.match(/data-chart-points="([^"]+)"/)?.[1];
    const topPoints = JSON.parse(topPointsEncoded!.replaceAll("&quot;", '"')) as typeof items;
    expect(topPoints.some((item) => item.country_code === "unknown")).toBe(false);
  });
});
