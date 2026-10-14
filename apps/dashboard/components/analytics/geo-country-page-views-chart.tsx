"use client";

import React from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartGrid, ChartTooltip, ChartTooltipContent } from "../ui/chart";

import type { GeoCountryResponse } from "../../lib/analytics/analytics-api/types";

const TOP_COUNTRY_COUNT = 10;

export function GeoCountryPageViewsChart({ items }: { items: GeoCountryResponse["items"] }) {
  const topCountries = items.slice(0, TOP_COUNTRY_COUNT);

  return (
    <div className="mb-6">
      <p className="mb-3 text-sm text-muted">Showing the first 10 countries returned by the API.</p>
      <ChartContainer
        config={{ page_views: { label: "Page Views", color: "var(--color-chart-1)" } }}
        className="h-[320px] min-h-[240px]"
        aria-label="Top countries by page views"
        role="group"
      >
        <BarChart
          data={topCountries}
          accessibilityLayer
          layout="vertical"
          margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
        >
          <ChartGrid horizontal={false} />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey="country_code"
            width={112}
            tickLine={false}
            axisLine={false}
            tickFormatter={(countryCode: string) =>
              countryCode === "unknown" ? "Unknown" : countryCode
            }
          />
          <ChartTooltip
            content={(props) => (
              <ChartTooltipContent
                {...props}
                labelFormatter={(countryCode) =>
                  countryCode === "unknown" ? "Unknown" : String(countryCode)
                }
              />
            )}
          />
          <Bar dataKey="page_views" name="Page Views" fill="var(--color-page_views)" radius={4} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
