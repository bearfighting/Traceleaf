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

  it("renders an empty Visitors report when only page views exist", () => {
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

    expect(markup).toContain("No analytics data is available");
    expect(markup).not.toContain("2026-09-20");
    expect(overviewMarkup).toContain("2026-09-20");
  });

  it("omits page-view-only days from focused audience reports", () => {
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

    expect(visitorsMarkup).toContain("2026-09-21");
    expect(visitorsMarkup).not.toContain("2026-09-20");
    expect(sessionsMarkup).toContain("2026-09-21");
    expect(sessionsMarkup).not.toContain("2026-09-20");
  });
});
