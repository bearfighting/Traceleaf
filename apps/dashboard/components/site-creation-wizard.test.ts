import { describe, expect, it } from "vitest";

import {
  closeCapabilityDependencies,
  deriveOrigin,
  siteCreateFieldName,
} from "./site-creation-wizard";

const manifest = [
  { id: "page_views", status: "implemented", depends_on: [] },
  { id: "browser_context", status: "implemented", depends_on: ["page_views"] },
  { id: "dimensions", status: "implemented", depends_on: ["browser_context"] },
  { id: "future", status: "planned", depends_on: [] },
];

describe("site onboarding inputs", () => {
  it("derives only http(s) Origins without paths or query strings", () => {
    expect(deriveOrigin("https://www.example.test/path?q=1")).toBe("https://www.example.test");
    expect(deriveOrigin("javascript:alert(1)")).toBeNull();
    expect(deriveOrigin("not a URL")).toBeNull();
  });

  it("closes selected capability dependencies and excludes unimplemented items", () => {
    expect(closeCapabilityDependencies(["dimensions"], manifest)).toEqual([
      "page_views",
      "dimensions",
      "browser_context",
    ]);
    expect(closeCapabilityDependencies([], manifest)).toEqual(["page_views"]);
  });

  it("maps API JSON Pointer paths onto the onboarding fields", () => {
    expect(siteCreateFieldName("/display_name")).toBe("name");
    expect(siteCreateFieldName("/website_url")).toBe("websiteUrl");
    expect(siteCreateFieldName("/allowed_origins/0")).toBe("origins");
    expect(siteCreateFieldName("/capabilities/browser_context/enabled")).toBe("enabled");
  });
});
