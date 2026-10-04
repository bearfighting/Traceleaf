import { describe, expect, it } from "vitest";

import {
  analyticsReportRoute,
  dashboardRoute,
  legacySettingsRedirect,
  settingsRoute,
} from "./settings-routes";

describe("Settings routes", () => {
  it("builds a direct Definitions URL and preserves context", () => {
    expect(
      settingsRoute("definitions", {
        siteId: "site_alpha",
        environment: "staging",
        from: "2026-09-01",
        to: "2026-09-30",
        dimension: "browser",
        definitionVersion: "r2",
      }),
    ).toBe(
      "/dashboard/settings/definitions?site_id=site_alpha&environment=staging&from=2026-09-01&to=2026-09-30&dimension=browser&definition_version=r2",
    );
  });
  it("keeps Site and reporting context when building the Overview route", () => {
    expect(
      settingsRoute("overview", {
        siteId: "site alpha",
        environment: "production",
        from: "2026-09-01",
        to: "2026-09-30",
        dimension: "browser",
        definitionVersion: "revision 2",
      }),
    ).toBe(
      "/dashboard/settings/overview?site_id=site+alpha&environment=production&from=2026-09-01&to=2026-09-30&dimension=browser&definition_version=revision+2",
    );
  });

  it("builds directly addressable task routes with site and environment context", () => {
    expect(settingsRoute("environments", { siteId: "site_alpha", environment: "preview" })).toBe(
      "/dashboard/settings/environments?site_id=site_alpha&environment=preview",
    );
    expect(settingsRoute("capabilities", { siteId: "site_alpha" })).toBe(
      "/dashboard/settings/capabilities?site_id=site_alpha",
    );
  });

  it("builds Analytics links with the same allowed context parameters", () => {
    expect(
      dashboardRoute({
        siteId: "site_alpha",
        environment: "production",
        from: "2026-09-01",
        to: "2026-09-30",
        dimension: "browser",
        definitionVersion: "r2",
      }),
    ).toBe("/dashboard?site_id=site_alpha&from=2026-09-01&to=2026-09-30&environment=production");
  });

  it("keeps only parameters supported by the report destination", () => {
    const context = {
      siteId: "site alpha",
      environment: "preview / west",
      from: "2026-09-01",
      to: "2026-09-30",
      dimension: "language",
      definitionVersion: "rev 2",
    };
    expect(analyticsReportRoute("dimensions", context)).toBe(
      "/dashboard/dimensions?site_id=site+alpha&from=2026-09-01&to=2026-09-30&environment=preview+%2F+west&dimension=language",
    );
    expect(analyticsReportRoute("conversions", context)).toContain("definition_version=rev+2");
    expect(analyticsReportRoute("funnels", context)).toContain("definition_version=rev+2");
    expect(analyticsReportRoute("pages", context)).not.toMatch(/dimension|definition_version/);
  });

  it("temporarily redirects legacy Settings links with all supported query parameters", () => {
    expect(
      legacySettingsRedirect({
        site_id: "site_alpha",
        environment: "production",
        from: "2026-09-01",
        to: "2026-09-30",
        dimension: "browser",
        definition_version: "r2",
      }),
    ).toBe(
      "/dashboard/settings/overview?site_id=site_alpha&environment=production&from=2026-09-01&to=2026-09-30&dimension=browser&definition_version=r2",
    );
  });

  it("uses the first value for repeated query parameters", () => {
    expect(legacySettingsRedirect({ site_id: ["site_alpha", "site_beta"] })).toBe(
      "/dashboard/settings/overview?site_id=site_alpha",
    );
  });
});
