import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OverviewPageViewsChart } from "./overview-page-views-chart";

import type { TimelineItem } from "../../lib/analytics/analytics-api/types";

vi.mock("recharts", async () => {
  const ReactModule = await import("react");

  return {
    Line: ({ dataKey }: { dataKey: string }) =>
      ReactModule.createElement("span", { "data-line-key": dataKey }),
    LineChart: ({ data, children }: { data: TimelineItem[]; children: React.ReactNode }) =>
      ReactModule.createElement(
        "div",
        { "data-testid": "line-chart", "data-points": JSON.stringify(data) },
        children,
      ),
    XAxis: () => null,
    YAxis: () => null,
  };
});

vi.mock("../ui/chart", async () => {
  const ReactModule = await import("react");
  type TooltipRendererProps = { label?: React.ReactNode };

  return {
    ChartContainer: ({
      children,
      ...props
    }: React.ComponentProps<"div"> & { config: unknown; children: React.ReactNode }) =>
      ReactModule.createElement("div", props, children),
    ChartGrid: () => null,
    ChartTooltip: ({
      content,
    }: {
      content: React.ReactNode | ((props: TooltipRendererProps) => React.ReactNode);
    }) =>
      typeof content === "function"
        ? content({ label: "2026-09-02" } as TooltipRendererProps)
        : content,
    ChartTooltipContent: ({
      labelFormatter,
    }: {
      labelFormatter?: (label: React.ReactNode) => React.ReactNode;
    }) => ReactModule.createElement("span", null, labelFormatter?.("2026-09-02")),
  };
});

describe("OverviewPageViewsChart", () => {
  it("passes API dates and values to the Page Views series unchanged and labels tooltips in UTC", () => {
    const items = [
      { day: "2026-09-02", page_views: 0 },
      { day: "2026-09-01", page_views: 7 },
    ];

    const markup = renderToStaticMarkup(<OverviewPageViewsChart items={items} />);
    const serializedPoints = markup.match(/data-points="([^"]+)"/)?.[1];

    expect(serializedPoints).toBeDefined();
    expect(JSON.parse(serializedPoints!.replaceAll("&quot;", '"'))).toEqual(items);
    expect(markup).toContain('data-line-key="page_views"');
    expect(markup).toContain("2026-09-02 UTC");
  });
});
