"use client";

import { WEB_VITAL_METRICS } from "@web-analytics/protocol-ts";
import React from "react";
import { Bar, BarChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartGrid, ChartTooltip, ChartTooltipContent } from "../ui/chart";

import { buildWebVitalsChartData, getWebVitalsChartHeight } from "./web-vitals-chart-data";

import type { WebVitalsResponse } from "../../lib/analytics/analytics-api/types";
import type { WebVitalMetric } from "@web-analytics/protocol-ts";

const METRIC_LABELS: Record<WebVitalMetric, string> = {
  LCP: "Largest Contentful Paint (LCP)",
  INP: "Interaction to Next Paint (INP)",
  CLS: "Cumulative Layout Shift (CLS)",
  FCP: "First Contentful Paint (FCP)",
  TTFB: "Time to First Byte (TTFB)",
};

export function WebVitalsChart({ items }: { items: WebVitalsResponse["items"] }) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Rating counts include every returned route. p75 is shown only when the API reports enough
        samples; its vertical markers show the shared Good and Needs improvement limits.
      </p>
      {WEB_VITAL_METRICS.map((metric) => {
        const chartData = buildWebVitalsChartData(items, metric);
        if (chartData.items.length === 0) return null;
        const { items: metricItems, p75Items, thresholds } = chartData;
        const chartHeight = getWebVitalsChartHeight(metricItems.length);
        const p75ChartHeight = getWebVitalsChartHeight(p75Items.length);
        const unit = metric === "CLS" ? "" : " ms";
        const chartConfig = {
          good_count: { label: "Good", color: "var(--color-chart-2)" },
          needs_improvement_count: { label: "Needs improvement", color: "var(--color-chart-4)" },
          poor_count: { label: "Poor", color: "var(--color-chart-5)" },
          p75: { label: `p75${unit}`, color: "var(--color-chart-1)" },
        };

        return (
          <section key={metric} aria-labelledby={`web-vitals-${metric}-heading`}>
            <h3 id={`web-vitals-${metric}-heading`} className="mb-2 font-medium">
              {METRIC_LABELS[metric]}
              {metric !== "CLS" ? " (ms)" : ""}
            </h3>
            <div
              className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"
              aria-label="Rating legend"
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-sm bg-[var(--color-chart-2)]"
                />
                Good
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-sm bg-[var(--color-chart-4)]"
                />
                Needs improvement
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-sm bg-[var(--color-chart-5)]"
                />
                Poor
              </span>
              <span>Rating distribution by route · sample count</span>
            </div>
            <ChartContainer
              config={chartConfig}
              className="min-h-[220px]"
              style={{ height: chartHeight }}
              aria-label={`${metric} rating sample counts by route`}
              role="group"
            >
              <BarChart
                data={metricItems}
                accessibilityLayer
                layout="vertical"
                margin={{ left: 8, right: 12 }}
              >
                <ChartGrid horizontal={false} />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="path"
                  width={120}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(path: string) =>
                    path.length > 20 ? `${path.slice(0, 17)}…` : path
                  }
                />
                <ChartTooltip
                  content={(props) => (
                    <ChartTooltipContent {...props} labelFormatter={(path) => String(path)} />
                  )}
                />
                <Bar
                  dataKey="good_count"
                  name="Good"
                  stackId="ratings"
                  fill="var(--color-good_count)"
                />
                <Bar
                  dataKey="needs_improvement_count"
                  name="Needs improvement"
                  stackId="ratings"
                  fill="var(--color-needs_improvement_count)"
                />
                <Bar
                  dataKey="poor_count"
                  name="Poor"
                  stackId="ratings"
                  fill="var(--color-poor_count)"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ChartContainer>
            <p className="mb-2 mt-4 text-xs text-muted">p75 by route{unit}</p>
            {p75Items.length === 0 ? (
              <p className="text-sm text-muted">
                p75 unavailable because no route has enough samples.
              </p>
            ) : (
              <ChartContainer
                config={chartConfig}
                className="min-h-[220px]"
                style={{ height: p75ChartHeight }}
                aria-label={`${metric} p75 by route${unit}`}
                role="group"
              >
                <BarChart
                  data={p75Items}
                  accessibilityLayer
                  layout="vertical"
                  margin={{ left: 8, right: 20 }}
                >
                  <ChartGrid horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, (max: number) => Math.max(max, thresholds[1]) * 1.08]}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => `${value}${unit}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="path"
                    width={120}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(path: string) =>
                      path.length > 20 ? `${path.slice(0, 17)}…` : path
                    }
                  />
                  <ReferenceLine
                    x={thresholds[0]}
                    stroke="var(--color-chart-2)"
                    strokeDasharray="4 4"
                    label={{ value: "Good", position: "top" }}
                  />
                  <ReferenceLine
                    x={thresholds[1]}
                    stroke="var(--color-chart-4)"
                    strokeDasharray="4 4"
                    label={{ value: "Needs improvement", position: "top" }}
                  />
                  <ChartTooltip
                    content={(props) => (
                      <ChartTooltipContent {...props} labelFormatter={(path) => String(path)} />
                    )}
                  />
                  <Bar dataKey="p75" name={`p75${unit}`} fill="var(--color-p75)" radius={4} />
                </BarChart>
              </ChartContainer>
            )}
          </section>
        );
      })}
    </div>
  );
}
