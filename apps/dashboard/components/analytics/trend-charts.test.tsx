import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TopPagesChart } from "./top-pages-chart";
import { VisitorSessionTrendChart } from "./visitor-session-trend-chart";

vi.mock("recharts", async () => {
  const ReactModule = await import("react");

  return {
    Bar: ({ dataKey }: { dataKey: string }) =>
      ReactModule.createElement("span", { "data-bar-key": dataKey }),
    BarChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) =>
      ReactModule.createElement("div", { "data-chart-points": JSON.stringify(data) }, children),
    Line: ({ dataKey }: { dataKey: string }) =>
      ReactModule.createElement("span", { "data-line-key": dataKey }),
    LineChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) =>
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

describe("report charts", () => {
  it("binds the focused metric while preserving API day order and zero values", () => {
    const items = [
      { day: "2026-09-02", page_views: 0, unique_visitors: 0, sessions: 4 },
      { day: "2026-09-01", page_views: 1, unique_visitors: 3, sessions: 0 },
    ];
    const visitors = renderToStaticMarkup(
      <VisitorSessionTrendChart items={items} focus="visitors" />,
    );
    const sessions = renderToStaticMarkup(
      <VisitorSessionTrendChart items={items} focus="sessions" />,
    );

    expect(visitors).toContain('data-line-key="unique_visitors"');
    expect(sessions).toContain('data-line-key="sessions"');
    expect(visitors).toContain("2026-09-02");
    expect(visitors).toContain("unique_visitors&quot;:0");
    expect(sessions).toContain("sessions&quot;:4");
  });

  it("plots only the first ten API-ranked paths", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      path: `/article/${index}`,
      page_views: 12 - index,
    }));
    const markup = renderToStaticMarkup(<TopPagesChart items={items} />);
    const encodedPoints = markup.match(/data-chart-points="([^"]+)"/)?.[1];
    const points = JSON.parse(encodedPoints!.replaceAll("&quot;", '"')) as typeof items;

    expect(points).toEqual(items.slice(0, 10));
    expect(markup).toContain("first 10 paths returned by the API");
  });
});
