import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalyticsSidebar } from "./analytics-sidebar";

describe("AnalyticsSidebar", () => {
  it("provides grouped report anchors in desktop and mobile navigation", () => {
    const markup = renderToStaticMarkup(<AnalyticsSidebar />);

    expect(markup).toContain('aria-label="Analytics reports"');
    expect(markup).toContain("Browse reports");
    expect(markup).toContain('href="#overview"');
    expect(markup).toContain('href="#timeline"');
    expect(markup).toContain('href="#top-pages"');
    expect(markup).toContain('href="#dimensions"');
    expect(markup).toContain('href="#visitors"');
    expect(markup).toContain('href="#sessions"');
    expect(markup).toContain('href="#custom-events"');
    expect(markup).toContain('href="#web-vitals"');
    expect(markup).toContain('href="#countries"');
    expect(markup).toContain('href="#conversions"');
    expect(markup).toContain('href="#funnels"');
    expect(markup).toContain('aria-current="location"');
  });
});
