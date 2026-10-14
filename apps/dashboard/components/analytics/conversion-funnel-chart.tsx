"use client";

import React from "react";
import { Bar, BarChart, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartGrid,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
} from "../ui/chart";

import { formatCategoryAxisLabel } from "./chart-labels";
import {
  conversionChartRows,
  conversionSeriesKey,
  formatConversionRate,
} from "./conversion-funnel-chart-data";

import type {
  ConversionReportItem,
  FunnelReportItem,
} from "../../lib/analytics/analytics-api/types";

export interface ConversionSeries {
  definitionId: string;
  label: string;
  color: string;
  strokeDasharray: string;
  items: ConversionReportItem[];
}

export interface FunnelSeries {
  definitionId: string;
  definitionLabel: string;
  day: string;
  color: string;
  items: Array<FunnelReportItem & { label: string }>;
}

export function ConversionRateCharts({ series }: { series: ConversionSeries[] }) {
  const rows = conversionChartRows(series);
  const config = Object.fromEntries(
    series.map(({ definitionId, label, color }) => [
      conversionSeriesKey(definitionId),
      { label, color },
    ]),
  );

  return (
    <ChartContainer config={config} aria-label="Conversion rates by UTC date" role="group">
      <LineChart data={rows} accessibilityLayer margin={{ left: 8, right: 12, top: 12 }}>
        <ChartGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`}
          width={48}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const dayItems = series.flatMap((item) => {
              const record = item.items.find((entry) => entry.day === String(label));

              return record ? [{ label: item.label, color: item.color, ...record }] : [];
            });

            return (
              <div className="rounded-md border border-chart-tooltip-border bg-chart-tooltip-background px-3 py-2 text-sm shadow-md">
                <div className="mb-1 font-medium">{String(label)} UTC</div>
                {dayItems.map((item) => (
                  <div key={item.definition_id} className="grid grid-cols-2 gap-x-3">
                    <span style={{ color: item.color }}>{item.label}</span>
                    <span className="text-right">
                      {formatConversionRate(item)}
                      {item.eligible_sessions === 0 ? " (0 eligible sessions)" : ""}
                    </span>
                    <span className="text-muted">Converted / eligible</span>
                    <span className="text-right">
                      {item.converted_sessions} / {item.eligible_sessions}
                    </span>
                  </div>
                ))}
              </div>
            );
          }}
        />
        {series.map((item) => (
          <Line
            key={item.definitionId}
            type="monotone"
            dataKey={conversionSeriesKey(item.definitionId)}
            name={item.label}
            stroke={item.color}
            strokeDasharray={item.strokeDasharray || undefined}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </LineChart>
    </ChartContainer>
  );
}

export function FunnelStepCharts({ series }: { series: FunnelSeries[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {series.map((funnel) => {
        const config = Object.fromEntries(
          funnel.items.map((item) => [
            `step-${item.step_index}`,
            { label: item.label, color: funnel.color },
          ]),
        );

        return (
          <section
            className="card"
            key={`${funnel.definitionId}:${funnel.day}`}
            aria-label={`${funnel.definitionLabel}, ${funnel.day}`}
          >
            <h3>
              {funnel.definitionLabel} · {funnel.day} UTC
            </h3>
            <ChartContainer
              config={config}
              aria-label={`${funnel.definitionLabel} steps for ${funnel.day}`}
              role="group"
            >
              <BarChart
                data={funnel.items}
                accessibilityLayer
                margin={{ left: 8, right: 12, top: 12 }}
              >
                <ChartGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(label: string) => formatCategoryAxisLabel(label, 16)}
                />
                <YAxis allowDecimals={false} width={42} tickLine={false} axisLine={false} />
                <ChartTooltip
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as FunnelSeries["items"][number] | undefined;
                    if (!active || !row) return null;

                    return (
                      <div className="rounded-md border border-chart-tooltip-border bg-chart-tooltip-background px-3 py-2 text-sm shadow-md">
                        <div className="font-medium">{row.label}</div>
                        <div>{row.sessions} sessions</div>
                        <div>{(row.conversion_rate * 100).toFixed(1)}% from previous step</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="sessions" name="Sessions" fill={funnel.color} radius={4} />
              </BarChart>
            </ChartContainer>
          </section>
        );
      })}
    </div>
  );
}
