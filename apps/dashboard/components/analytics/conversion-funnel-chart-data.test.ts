import { describe, expect, it } from "vitest";

import {
  conversionChartRows,
  conversionChartSeries,
  formatConversionRate,
  funnelChartSeries,
} from "./conversion-funnel-chart-data";

import type {
  ConversionReportResponse,
  FunnelReportResponse,
} from "../../lib/analytics/analytics-api/types";
import type { DefinitionSetResponse } from "../../lib/settings/configuration-api/types";

const definitions: DefinitionSetResponse = {
  schema_version: 1,
  site_id: "site",
  revision: 1,
  definition_version: "v1",
  effective_at: null,
  conversions: [
    { id: "buy", name: "Purchase", event_name: "purchase", active: true, properties: {} },
  ],
  funnels: [
    {
      id: "checkout",
      name: "Checkout",
      active: true,
      steps: [
        { event_name: "view", properties: {} },
        { event_name: "pay", properties: {} },
      ],
    },
  ],
};

describe("conversion chart data", () => {
  it("keeps definitions separate, orders dates, and preserves API rates and session counts", () => {
    const response = {
      definition_version: "v1",
      items: [
        {
          definition_id: "buy",
          day: "2026-01-02",
          event_count: 4,
          converted_sessions: 2,
          eligible_sessions: 5,
          conversion_rate: 0.4,
        },
        {
          definition_id: "unknown",
          day: "2026-01-01",
          event_count: 1,
          converted_sessions: 1,
          eligible_sessions: 3,
          conversion_rate: 0.2,
        },
        {
          definition_id: "buy",
          day: "2026-01-01",
          event_count: 2,
          converted_sessions: 1,
          eligible_sessions: 8,
          conversion_rate: 0.125,
        },
      ],
    } as ConversionReportResponse;
    const series = conversionChartSeries(response, definitions);
    expect(series.map(({ label }) => label)).toEqual(["Purchase", "unknown"]);
    expect(series[0].items.map(({ day }) => day)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(series[0].items[0]).toMatchObject({
      conversion_rate: 0.125,
      converted_sessions: 1,
      eligible_sessions: 8,
    });
  });

  it("omits uncomputable zero-denominator rates while retaining returned dates", () => {
    const response = {
      items: [
        {
          definition_id: "day",
          day: "2026-01-01",
          event_count: 0,
          converted_sessions: 0,
          eligible_sessions: 0,
          conversion_rate: 0,
        },
        {
          definition_id: "buy",
          day: "2026-01-01",
          event_count: 2,
          converted_sessions: 1,
          eligible_sessions: 4,
          conversion_rate: 0.25,
        },
      ],
    } as ConversionReportResponse;
    const series = conversionChartSeries(response);

    expect(conversionChartRows(series)).toEqual([
      { day: "2026-01-01", conversion_day: null, conversion_buy: 0.25 },
    ]);
    expect(formatConversionRate(series[0].items[0])).toBe("N/A");
    expect(formatConversionRate(series[1].items[0])).toBe("25.0%");
  });

  it("keeps conversion series visually distinct beyond the theme palette", () => {
    const response = {
      items: Array.from({ length: 8 }, (_, index) => ({
        definition_id: `conversion-${index}`,
        day: "2026-01-01",
        event_count: 1,
        converted_sessions: 1,
        eligible_sessions: 2,
        conversion_rate: 0.5,
      })),
    } as ConversionReportResponse;
    const series = conversionChartSeries(response);

    expect(new Set(series.map(({ color }) => color)).size).toBe(8);
    expect(new Set(series.map(({ strokeDasharray }) => strokeDasharray)).size).toBeGreaterThan(1);
  });

  it("uses ID labels when definitions are absent and groups sparse funnel steps by cohort", () => {
    const response = {
      items: [
        {
          definition_id: "checkout",
          day: "2026-01-02",
          step_index: 2,
          sessions: 3,
          conversion_rate: 0.5,
        },
        {
          definition_id: "checkout",
          day: "2026-01-01",
          step_index: 0,
          sessions: 6,
          conversion_rate: 1,
        },
        {
          definition_id: "checkout",
          day: "2026-01-01",
          step_index: 2,
          sessions: 3,
          conversion_rate: 0.5,
        },
      ],
    } as FunnelReportResponse;
    const grouped = funnelChartSeries(response, definitions);
    expect(grouped.map(({ day }) => day)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(grouped[0].items.map(({ step_index, label }) => [step_index, label])).toEqual([
      [0, "view"],
      [2, "Step 3"],
    ]);
    expect(
      grouped[0].items.map(({ step_index, sessions, conversion_rate }) => ({
        step_index,
        sessions,
        conversion_rate,
      })),
    ).toEqual([
      { step_index: 0, sessions: 6, conversion_rate: 1 },
      { step_index: 2, sessions: 3, conversion_rate: 0.5 },
    ]);
    expect(grouped[1].definitionLabel).toBe("Checkout");
    expect(funnelChartSeries(response)[0].definitionLabel).toBe("checkout");
  });
});
