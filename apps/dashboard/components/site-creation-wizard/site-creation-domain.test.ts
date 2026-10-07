import { describe, expect, it } from "vitest";

import {
  closeCapabilityDependencies,
  createSitePayload,
  deriveAllowedOrigins,
  deriveOrigin,
  siteCreateFieldName,
  validateSiteCreationStep,
} from "./site-creation-domain";

import type { SiteCreationValues } from "./site-creation-domain";

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

  it("derives allowed Origins with first-seen order and de-duplicates the website Origin", () => {
    expect(
      deriveAllowedOrigins(
        ["https://docs.example.test", "https://www.example.test", "https://docs.example.test"],
        "https://www.example.test/path",
      ),
    ).toEqual(["https://docs.example.test", "https://www.example.test"]);
  });

  it("validates each step with the existing field messages", () => {
    const values: SiteCreationValues = {
      name: "  ",
      websiteUrl: "invalid",
      environment: "bad value",
      origins: [],
    };
    expect(validateSiteCreationStep(0, values, [])).toEqual({
      name: "Enter a Site name.",
      websiteUrl: "Enter a valid http or https website URL.",
    });
    expect(validateSiteCreationStep(1, values, [])).toEqual({
      environment: "Use 1–64 letters, numbers, _ or -, starting with a letter or number.",
      origins: "Allowed Origins must include the website URL Origin.",
    });
  });

  it("builds the serialized request shape with trimmed values and manifest capability order", () => {
    const values: SiteCreationValues = {
      name: "  Example  ",
      websiteUrl: " https://www.example.test/path ",
      environment: "production",
      origins: [],
    };
    const payload = createSitePayload(
      values,
      manifest,
      ["page_views", "browser_context", "dimensions"],
      ["https://www.example.test"],
    );
    expect(JSON.stringify(payload)).toBe(
      '{"display_name":"Example","website_url":"https://www.example.test/path","environment":"production","capabilities":{"page_views":true,"browser_context":true,"dimensions":true,"future":false},"allowed_origins":["https://www.example.test"]}',
    );
  });
});
