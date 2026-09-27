import { describe, expect, it } from "vitest";

import { defaultDashboardDateRange, parseDashboardQuery } from "./query-params";

describe("dashboard query params", () => {
  const now = new Date("2026-09-20T23:45:00-04:00");

  it("uses a 30-day UTC default range", () => {
    expect(defaultDashboardDateRange(now)).toEqual({ from: "2026-08-23", to: "2026-09-21" });
  });

  it("uses the configured site and default range", () => {
    expect(parseDashboardQuery({}, "site_playground", ["site_playground"], now)).toEqual({
      params: {
        siteId: "site_playground",
        dateRange: { from: "2026-08-23", to: "2026-09-21" },
        dimension: "browser",
      },
    });
  });

  it("parses a valid explicit range", () => {
    expect(
      parseDashboardQuery(
        { site_id: "site_alpha", from: "2026-09-01", to: "2026-09-18" },
        "site_playground",
        ["site_playground", "site_alpha"],
        now,
      ),
    ).toEqual({
      params: {
        siteId: "site_alpha",
        dateRange: { from: "2026-09-01", to: "2026-09-18" },
        dimension: "browser",
      },
    });
  });

  it.each([
    ["partial_date_range", { from: "2026-09-01" }],
    ["invalid_date", { from: "2026-02-30", to: "2026-03-01" }],
    ["reversed_date_range", { from: "2026-09-18", to: "2026-09-01" }],
  ])("rejects %s", (code, searchParams) => {
    const result = parseDashboardQuery(searchParams, "site_playground", ["site_playground"], now);

    expect(result.error?.code).toBe(code);
  });

  it("rejects a site that is not configured", () => {
    const result = parseDashboardQuery(
      { site_id: "site_unknown" },
      "site_playground",
      ["site_playground"],
      now,
    );

    expect(result).toEqual({
      error: {
        code: "unknown_site",
        message: "The selected site is not configured for this dashboard.",
      },
    });
  });

  it("preserves an optional historical definition version", () => {
    const result = parseDashboardQuery(
      { site_id: "site_playground", definition_version: "r2-abc" },
      "site_playground",
      ["site_playground"],
      new Date("2026-09-19T00:00:00Z"),
    );
    expect(result.params?.definitionVersion).toBe("r2-abc");
    expect(
      parseDashboardQuery({ definition_version: "two versions" }, "site_playground", [
        "site_playground",
      ]).error,
    ).toBeDefined();
  });
});
