"use client";

import * as React from "react";
import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  type LegendProps,
  type TooltipContentProps,
  type TooltipProps,
} from "recharts";

import { cn } from "../../lib/utils";

import type { LegendPayload } from "recharts/types/component/DefaultLegendContent";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    color?: string;
  }
>;

const ChartConfigContext = React.createContext<ChartConfig | null>(null);

function useChartConfig() {
  const config = React.useContext(ChartConfigContext);
  if (!config) {
    throw new Error("Chart components must be used inside ChartContainer.");
  }

  return config;
}

export function ChartContainer({
  id,
  className,
  config,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof ResponsiveContainer>["children"];
}) {
  const generatedId = React.useId();
  const chartId = `chart-${id ?? generatedId.replace(/:/g, "")}`;

  return (
    <ChartConfigContext.Provider value={config}>
      <div
        data-chart={chartId}
        className={cn("relative h-[250px] min-h-[200px] w-full", className)}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </ChartConfigContext.Provider>
  );
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const entries = Object.entries(config).filter(([, item]) => item.color);
  if (entries.length === 0) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `\n${entries
          .map(([key, item]) => `[data-chart="${id}"] { --color-${key}: ${item.color}; }`)
          .join("\n")}`,
      }}
    />
  );
}

export function ChartTooltip(props: TooltipProps<ValueType, NameType>) {
  return <Tooltip {...props} />;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
}: TooltipContentProps<ValueType, NameType>) {
  const config = useChartConfig();
  if (!active || !payload?.length) return null;

  const formattedLabel = labelFormatter ? labelFormatter(label, payload) : label;

  return (
    <div className="rounded-md border border-chart-tooltip-border bg-chart-tooltip-background px-3 py-2 text-sm text-chart-tooltip-foreground shadow-md">
      {formattedLabel != null && <div className="mb-1 font-medium">{formattedLabel}</div>}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? index);
          const itemConfig = config[key];
          const formatted = formatter
            ? formatter(item.value, item.name, item, index, payload)
            : null;

          return (
            <div key={`${key}-${index}`} className="flex items-center gap-2">
              <span
                className="size-2 rounded-[2px]"
                style={{ backgroundColor: item.color ?? `var(--color-${key})` }}
              />
              <span className="text-muted">{itemConfig?.label ?? item.name ?? key}</span>
              <span className="ml-auto font-mono font-medium tabular-nums text-ink">
                {formatted ?? (item.value == null ? "—" : String(item.value))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChartLegend(props: LegendProps) {
  return <Legend {...props} />;
}

export function ChartLegendContent({ payload }: { payload?: LegendPayload[] }) {
  const config = useChartConfig();
  if (!payload?.length) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-3">
      {payload.map((item, index) => {
        const key = String(item.dataKey ?? item.value ?? index);

        return (
          <div
            key={`${key}-${index}`}
            className="flex items-center gap-2 text-sm text-chart-legend-foreground"
          >
            <span
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: item.color ?? `var(--color-${key})` }}
            />
            {config[key]?.label ?? item.value ?? key}
          </div>
        );
      })}
    </div>
  );
}

export function ChartGrid(props: React.ComponentProps<typeof CartesianGrid>) {
  return <CartesianGrid stroke="var(--color-chart-grid)" strokeDasharray="3 3" {...props} />;
}
