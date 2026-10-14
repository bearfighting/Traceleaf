"use client";

import React from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartGrid, ChartTooltip, ChartTooltipContent } from "../ui/chart";

import type { DimensionResponse } from "../../lib/analytics/analytics-api/types";

export function formatDimensionAxisLabel(value: string) {
  return value.length > 20 ? `${value.slice(0, 17)}…` : value;
}

export function formatDimensionTooltipLabel(value: unknown) {
  return String(value);
}

export function DimensionPageViewsChart({
  dimension,
  items,
}: {
  dimension: DimensionResponse["dimension"];
  items: DimensionResponse["items"];
}) {
  return (
    <div aria-label={`${dimension} page views chart`} className="mb-6">
      <h3 className="mb-3 text-base font-medium">Page Views by {dimension}</h3>
      <ChartContainer
        config={{ page_views: { label: "Page Views", color: "var(--color-chart-1)" } }}
        className="min-h-[240px]"
        style={{ height: `${Math.max(240, items.length * 36 + 24)}px` }}
        aria-label={`Page Views by ${dimension}`}
        role="group"
      >
        <BarChart
          data={items}
          accessibilityLayer
          layout="vertical"
          margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
        >
          <ChartGrid horizontal={false} />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey="value"
            width={128}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatDimensionAxisLabel}
          />
          <ChartTooltip
            content={(props) => (
              <ChartTooltipContent {...props} labelFormatter={formatDimensionTooltipLabel} />
            )}
          />
          <Bar dataKey="page_views" name="Page Views" fill="var(--color-page_views)" radius={4} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
