"use client";

import React from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartGrid, ChartTooltip, ChartTooltipContent } from "../ui/chart";

import type { PagesResponse } from "../../lib/analytics/analytics-api/types";

const TOP_PAGE_COUNT = 10;

export function TopPagesChart({ items }: { items: PagesResponse["items"] }) {
  const topPages = items.slice(0, TOP_PAGE_COUNT);

  return (
    <div>
      <p className="mb-3 text-sm text-muted">Showing the first 10 paths returned by the API.</p>
      <ChartContainer
        config={{ page_views: { label: "Page Views", color: "var(--color-chart-1)" } }}
        className="h-[320px] min-h-[240px]"
        aria-label="Top page paths by page views"
        role="group"
      >
        <BarChart
          data={topPages}
          accessibilityLayer
          layout="vertical"
          margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
        >
          <ChartGrid horizontal={false} />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey="path"
            width={120}
            tickLine={false}
            axisLine={false}
            tickFormatter={(path: string) => (path.length > 20 ? `${path.slice(0, 17)}…` : path)}
          />
          <ChartTooltip
            content={(props) => (
              <ChartTooltipContent {...props} labelFormatter={(path) => String(path)} />
            )}
          />
          <Bar dataKey="page_views" name="Page Views" fill="var(--color-page_views)" radius={4} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
