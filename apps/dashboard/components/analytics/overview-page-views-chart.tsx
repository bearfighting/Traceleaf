"use client";

import React from "react";
import { Line, LineChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartGrid, ChartTooltip, ChartTooltipContent } from "../ui/chart";

import type { TimelineItem } from "../../lib/analytics/analytics-api/types";

export function OverviewPageViewsChart({ items }: { items: TimelineItem[] }) {
  return (
    <ChartContainer
      config={{ page_views: { label: "Page Views", color: "var(--color-chart-1)" } }}
      aria-label="Page Views by UTC date"
      role="group"
    >
      <LineChart data={items} accessibilityLayer margin={{ left: 8, right: 12, top: 12 }}>
        <ChartGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} width={42} tickLine={false} axisLine={false} />
        <ChartTooltip
          content={(props) => (
            <ChartTooltipContent {...props} labelFormatter={(label) => `${String(label)} UTC`} />
          )}
        />
        <Line
          type="monotone"
          dataKey="page_views"
          name="Page Views"
          stroke="var(--color-page_views)"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ChartContainer>
  );
}
