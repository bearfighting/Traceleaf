import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConversionRateCharts, FunnelStepCharts } from "./conversion-funnel-chart";
import { conversionChartSeries, funnelChartSeries } from "./conversion-funnel-chart-data";

import type {
  ConversionReportResponse,
  FunnelReportResponse,
} from "../../lib/analytics/analytics-api/types";
import type { DefinitionSetResponse } from "../../lib/settings/configuration-api/types";

vi.mock("recharts", async () => {
  const ReactModule = await import("react");

  return {
    Bar: ({ dataKey }: { dataKey: string }) =>
      ReactModule.createElement("span", { "data-bar-key": dataKey }),
    BarChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) =>
      ReactModule.createElement("div", { "data-bar-chart-data": JSON.stringify(data) }, children),
    ChartGrid: () => null,
    Line: ({ dataKey }: { dataKey: string }) =>
      ReactModule.createElement("span", { "data-line-key": dataKey }),
    LineChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) =>
      ReactModule.createElement("div", { "data-line-chart-data": JSON.stringify(data) }, children),
    XAxis: () => null,
    YAxis: () => null,
  };
});

vi.mock("../ui/chart", async () => {
  const ReactModule = await import("react");

  return {
    ChartContainer: ({
      children,
      config,
      ...props
    }: React.ComponentProps<"div"> & { config: unknown }) => {
      void config;

      return ReactModule.createElement("div", props, children);
    },
    ChartGrid: () => null,
    ChartLegend: () => null,
    ChartLegendContent: () => null,
    ChartTooltip: () => null,
  };
});

function chartData(markup: string, attribute: string): unknown[] {
  const encoded = markup.match(new RegExp(`${attribute}="([^"]+)"`))?.[1];
  expect(encoded).toBeDefined();

  return JSON.parse(encoded!.replaceAll("&quot;", '"')) as unknown[];
}

describe("conversion and funnel chart components", () => {
  it("passes API rates and zero-denominator gaps to the rendered line chart", () => {
    const response = {
      items: [
        {
          definition_id: "purchase",
          day: "2026-09-02",
          event_count: 2,
          converted_sessions: 1,
          eligible_sessions: 4,
          conversion_rate: 0.25,
        },
        {
          definition_id: "purchase",
          day: "2026-09-01",
          event_count: 0,
          converted_sessions: 0,
          eligible_sessions: 0,
          conversion_rate: 0,
        },
      ],
    } as ConversionReportResponse;
    const markup = renderToStaticMarkup(
      <ConversionRateCharts series={conversionChartSeries(response)} />,
    );

    expect(markup).toContain('data-line-key="conversion_purchase"');
    expect(chartData(markup, "data-line-chart-data")).toEqual([
      { day: "2026-09-01", conversion_purchase: null },
      { day: "2026-09-02", conversion_purchase: 0.25 },
    ]);
  });

  it("renders definition and cohort labels with only the returned ordered funnel steps", () => {
    const response = {
      items: [
        {
          definition_id: "checkout",
          day: "2026-09-20",
          step_index: 2,
          sessions: 2,
          conversion_rate: 0.5,
        },
        {
          definition_id: "checkout",
          day: "2026-09-20",
          step_index: 0,
          sessions: 4,
          conversion_rate: 1,
        },
      ],
    } as FunnelReportResponse;
    const definitions = {
      schema_version: 1,
      site_id: "site",
      revision: 1,
      definition_version: "v1",
      effective_at: null,
      conversions: [],
      funnels: [
        {
          id: "checkout",
          name: "Checkout",
          active: true,
          steps: [
            { event_name: "start", properties: {} },
            { event_name: "finish", properties: {} },
            { event_name: "confirm", properties: {} },
          ],
        },
      ],
    } as DefinitionSetResponse;
    const markup = renderToStaticMarkup(
      <FunnelStepCharts series={funnelChartSeries(response, definitions)} />,
    );

    expect(markup).toContain("Checkout · 2026-09-20 UTC");
    expect(chartData(markup, "data-bar-chart-data")).toMatchObject([
      { step_index: 0, label: "start", sessions: 4, conversion_rate: 1 },
      { step_index: 2, label: "confirm", sessions: 2, conversion_rate: 0.5 },
    ]);
  });
});
