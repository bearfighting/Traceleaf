import { describe, expect, it } from "vitest";

import { isConversionReportResponse, isEventsResponse } from "./queries";

const response = () => ({
  site_id: "site_playground",
  from: "2026-09-18",
  to: "2026-09-19",
  total: 1,
  items: [],
  data_as_of: null,
  freshness_status: "current",
  aggregation_version: 1,
});

describe("isEventsResponse", () => {
  it("accepts the existing Events response shape without chart-only fields", () => {
    expect(isEventsResponse(response())).toBe(true);
  });
});

describe("isConversionReportResponse", () => {
  it("requires a separate daily chart series alongside limited detail rows", () => {
    const base = {
      ...response(),
      definition_version: "r1",
      chart_items: [],
    };

    expect(isConversionReportResponse(base)).toBe(true);
    expect(isConversionReportResponse({ ...base, chart_items: undefined })).toBe(false);
  });
});
