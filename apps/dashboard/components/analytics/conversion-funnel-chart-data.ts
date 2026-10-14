import type { ConversionSeries, FunnelSeries } from "./conversion-funnel-chart";
import type {
  ConversionReportResponse,
  ConversionReportItem,
  FunnelReportResponse,
} from "../../lib/analytics/analytics-api/types";
import type { DefinitionSetResponse } from "../../lib/settings/configuration-api/types";

const colors = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function conversionColor(index: number): string {
  if (index < colors.length) return colors[index];

  return `hsl(${((index - colors.length) * 137.508 + 24) % 360} 62% 35%)`;
}

export function conversionChartSeries(
  response: ConversionReportResponse,
  definitions?: DefinitionSetResponse | null,
): ConversionSeries[] {
  const byDefinition = new Map<string, ConversionReportResponse["items"]>();
  for (const item of response.items)
    byDefinition.set(item.definition_id, [...(byDefinition.get(item.definition_id) ?? []), item]);

  return [...byDefinition].map(([definitionId, items], index) => ({
    definitionId,
    label: definitions?.conversions.find((item) => item.id === definitionId)?.name ?? definitionId,
    color: conversionColor(index),
    strokeDasharray: ["", "6 3", "2 2", "8 2 2 2"][index % 4],
    items: [...items].sort((a, b) => a.day.localeCompare(b.day)),
  }));
}

export function conversionSeriesKey(definitionId: string): string {
  return `conversion_${definitionId}`;
}

export function conversionChartRows(series: ConversionSeries[]) {
  const days = [...new Set(series.flatMap((item) => item.items.map((entry) => entry.day)))].sort();

  return days.map((day) => ({
    day,
    ...Object.fromEntries(
      series.map((item) => {
        const entry = item.items.find((candidate) => candidate.day === day);

        return [
          conversionSeriesKey(item.definitionId),
          entry && entry.eligible_sessions > 0 ? entry.conversion_rate : null,
        ];
      }),
    ),
  }));
}

export function formatConversionRate(item: ConversionReportItem): string {
  return item.eligible_sessions === 0 ? "N/A" : `${(item.conversion_rate * 100).toFixed(1)}%`;
}

export function funnelChartSeries(
  response: FunnelReportResponse,
  definitions?: DefinitionSetResponse | null,
): FunnelSeries[] {
  const groups = new Map<string, FunnelReportResponse["items"]>();
  for (const item of response.items) {
    const key = `${item.definition_id}\u0000${item.day}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups]
    .map(([key, items], index) => {
      const [definitionId, day] = key.split("\u0000");
      const funnel = definitions?.funnels.find((item) => item.id === definitionId);

      return {
        definitionId,
        definitionLabel: funnel?.name ?? definitionId,
        day,
        color: colors[index % colors.length],
        items: [...items]
          .sort((a, b) => a.step_index - b.step_index)
          .map((item) => ({
            ...item,
            label: funnel?.steps[item.step_index]?.event_name || `Step ${item.step_index + 1}`,
          })),
      };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.definitionId.localeCompare(b.definitionId));
}
