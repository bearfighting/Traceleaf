import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DefinitionEditor } from "./definition-editor";

describe("DefinitionEditor", () => {
  it("shows an actionable setup error when the Admin credential is missing", () => {
    const html = renderToStaticMarkup(
      <DefinitionEditor
        siteId="site_playground"
        result={{ kind: "unconfigured", message: "Admin token missing" }}
      />,
    );
    expect(html).toContain("Definition management unavailable");
    expect(html).toContain("Admin token missing");
  });

  it("renders empty-state controls for adding conversions and ordered funnels", () => {
    const html = renderToStaticMarkup(
      <DefinitionEditor siteId="site_playground" result={{ kind: "ready", definitions: null }} />,
    );
    expect(html).toContain("Conversions and funnels");
    expect(html).toContain("Add conversion");
    expect(html).toContain("Funnels");
    expect(html).toContain("Add funnel");
    expect(html).toContain("Save new revision");
  });
});
