import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalyticsApiClientError } from "../lib/analytics-api/errors";

import { TopPagesTable } from "./top-pages-table";

import type { PagesResponse } from "../lib/analytics-api/types";

const context = { siteId: "site_playground", dateRange: { from: "2026-09-18", to: "2026-09-18" } };

describe("TopPagesTable", () => {
  it("renders API order and path values without sorting", () => {
    const data: PagesResponse = {
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
      items: [
        { path: "/about", page_views: 2 },
        { path: "/", page_views: 1 },
      ],
    };

    const markup = renderToStaticMarkup(
      <TopPagesTable context={context} state={{ status: "success", data }} />,
    );

    expect(markup).toMatch(/<table\b[^>]*\btabindex="0"/);
    expect(markup.indexOf("<code>/about</code>")).toBeLessThan(markup.indexOf("<code>/</code>"));
    expect(markup).toContain("2");
    expect(markup).toContain("1");
  });

  it("renders an error state with query context", () => {
    const markup = renderToStaticMarkup(
      <TopPagesTable
        context={context}
        state={{
          status: "error",
          error: new AnalyticsApiClientError("Pages unavailable", { kind: "http", status: 503 }),
        }}
      />,
    );

    expect(markup).toContain("Pages unavailable");
    expect(markup).toContain("site_playground");
    expect(markup).toContain("2026-09-18 to 2026-09-18 UTC");
  });

  it("renders an empty state for an empty response", () => {
    const data: PagesResponse = {
      site_id: context.siteId,
      from: context.dateRange.from,
      to: context.dateRange.to,
      items: [],
    };

    const markup = renderToStaticMarkup(
      <TopPagesTable context={context} state={{ status: "success", data }} />,
    );

    expect(markup).toContain("No page view data is available for this selection.");
  });
});
