import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReportLoadingState } from "./report-loading-state";

describe("ReportLoadingState", () => {
  it("identifies the report section while loading", () => {
    const markup = renderToStaticMarkup(<ReportLoadingState heading="Dimension Report" />);

    expect(markup).toContain("Dimension Report");
    expect(markup).toContain("Loading analytics data");
    expect(markup).toContain('role="status"');
  });
});
