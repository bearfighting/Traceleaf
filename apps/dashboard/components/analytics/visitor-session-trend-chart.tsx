"use client";

import React from "react";
import { Line, LineChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartGrid, ChartTooltip, ChartTooltipContent } from "../ui/chart";

import type { VisitorSessionItem } from "../../lib/analytics/analytics-api/types";

export function VisitorSessionTrendChart({
  items,
  focus,
}: {
  items: VisitorSessionItem[];
  focus: "visitors" | "sessions";
}) {
  const metric = focus === "visitors" ? "unique_visitors" : "sessions";
  const label = focus === "visitors" ? "Unique Visitors" : "Sessions";

  return (
    <ChartContainer
      config={{ [metric]: { label, color: "var(--color-chart-1)" } }}
      aria-label={`${label} by UTC date`}
      role="group"
    >
      <LineChart data={items} accessibilityLayer margin={{ left: 8, right: 12, top: 12 }}>
        <ChartGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} width={42} tickLine={false} axisLine={false} />
        <ChartTooltip
          content={(props) => (
            <ChartTooltipContent {...props} labelFormatter={(day) => `${String(day)} UTC`} />
          )}
        />
        <Line
          type="monotone"
          dataKey={metric}
          name={label}
          stroke={`var(--color-${metric})`}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ChartContainer>
  );
}
