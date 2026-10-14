import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VisitorSessionTrendTable } from "./visitor-session-trend-table";

const context = { siteId: "site_playground", dateRange: { from: "2026-09-20", to: "2026-09-21" } };

describe("VisitorSessionTrendTable", () => {
  it("renders API daily order and all audience metrics", () => {
    const markup = renderToStaticMarkup(
      <VisitorSessionTrendTable
        context={context}
        state={{
          status: "success",
          data: {
            site_id: context.siteId,
            from: context.dateRange.from,
            to: context.dateRange.to,
            page_views: 5,
            unique_visitors: 2,
            sessions: 3,
            items: [{ day: "2026-09-20", page_views: 3, unique_visitors: 1, sessions: 2 }],
            data_as_of: "2026-09-21T12:00:00Z",
            freshness_status: "current",
            aggregation_version: 1,
          },
        }}
      />,
    );

    expect(markup).toContain("Unique Visitors");
    expect(markup).toContain("2026-09-20");
    expect(markup).toContain("3");
  });

  it("renders disabled state independently", () => {
    const markup = renderToStaticMarkup(
      <VisitorSessionTrendTable
        context={context}
        state={{ status: "disabled", error: new Error("disabled") as never }}
      />,
    );

    expect(markup).toContain("Audience analytics are not enabled");
    expect(markup).toContain("/dashboard/settings/capabilities?site_id=site_playground");
  });

  it("renders an empty state", () => {
    const markup = renderToStaticMarkup(
      <VisitorSessionTrendTable
        context={context}
        state={{
          status: "success",
          data: {
            site_id: context.siteId,
            from: context.dateRange.from,
            to: context.dateRange.to,
            page_views: 0,
            unique_visitors: 0,
            sessions: 0,
            items: [],
            data_as_of: null,
            freshness_status: "current",
            aggregation_version: 1,
          },
        }}
      />,
    );

    expect(markup).toContain("No analytics data is available");
  });

  it("renders zero-valued focus metrics for days with only page views", () => {
    const state = {
      status: "success" as const,
      data: {
        site_id: context.siteId,
        from: context.dateRange.from,
        to: context.dateRange.to,
        page_views: 1,
        unique_visitors: 0,
        sessions: 0,
        items: [{ day: "2026-09-20", page_views: 1, unique_visitors: 0, sessions: 0 }],
        data_as_of: "2026-09-21T12:00:00Z",
        freshness_status: "current" as const,
        aggregation_version: 1,
      },
    };
    const markup = renderToStaticMarkup(
      <VisitorSessionTrendTable context={context} focus="visitors" state={state} />,
    );
    const overviewMarkup = renderToStaticMarkup(
      <VisitorSessionTrendTable context={context} state={state} />,
    );

    expect(markup).toContain("Unique Visitors by UTC date");
    expect(markup).toContain("<td>2026-09-20</td><td>0</td>");
    expect(overviewMarkup).toContain("2026-09-20");
  });

  it("preserves API days with zero focused values in charts and tables", () => {
    const state = {
      status: "success" as const,
      data: {
        site_id: context.siteId,
        from: context.dateRange.from,
        to: context.dateRange.to,
        page_views: 2,
        unique_visitors: 1,
        sessions: 1,
        items: [
          { day: "2026-09-20", page_views: 1, unique_visitors: 0, sessions: 0 },
          { day: "2026-09-21", page_views: 1, unique_visitors: 1, sessions: 1 },
        ],
        data_as_of: "2026-09-21T12:00:00Z",
        freshness_status: "current" as const,
        aggregation_version: 1,
      },
    };

    const visitorsMarkup = renderToStaticMarkup(
      <VisitorSessionTrendTable context={context} focus="visitors" state={state} />,
    );
    const sessionsMarkup = renderToStaticMarkup(
      <VisitorSessionTrendTable context={context} focus="sessions" state={state} />,
    );

    expect(visitorsMarkup).toContain("<td>2026-09-20</td><td>0</td>");
    expect(visitorsMarkup).toContain("<td>2026-09-21</td><td>1</td>");
    expect(sessionsMarkup).toContain("<td>2026-09-20</td><td>0</td>");
    expect(sessionsMarkup).toContain("<td>2026-09-21</td><td>1</td>");
  });

  it("shows a focused report when its API series contains only zero values", () => {
    const markup = renderToStaticMarkup(
      <VisitorSessionTrendTable
        context={context}
        focus="visitors"
        state={{
          status: "success",
          data: {
            site_id: context.siteId,
            from: context.dateRange.from,
            to: context.dateRange.to,
            page_views: 1,
            unique_visitors: 0,
            sessions: 1,
            items: [{ day: "2026-09-20", page_views: 1, unique_visitors: 0, sessions: 1 }],
            data_as_of: "2026-09-21T12:00:00Z",
            freshness_status: "current",
            aggregation_version: 1,
          },
        }}
      />,
    );

    expect(markup).toContain("Unique Visitors by UTC date");
    expect(markup).toContain("<td>2026-09-20</td><td>0</td>");
    expect(markup).not.toContain("No analytics data is available");
  });
});
