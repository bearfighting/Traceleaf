import { describe, expect, it } from "vitest";

import { selectDashboardSite, siteOptions } from "./sites";

import type { ManagedSite } from "../lib/site-management/client";

const active: ManagedSite = {
  site_id: "site_active",
  display_name: "Active site",
  website_url: "https://active.example",
  lifecycle_status: "active",
  setup_status: "ready",
  missing_requirements: [],
  version: 1,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};
const archived: ManagedSite = {
  ...active,
  site_id: "site_archived",
  display_name: null,
  website_url: null,
  lifecycle_status: "archived",
  setup_status: "needs_attention",
  missing_requirements: ["website_url"],
};

describe("Dashboard Site selection", () => {
  it("chooses the first active Site when the URL has no site_id", () => {
    expect(selectDashboardSite([archived, active])).toEqual({ kind: "selected", site: active });
  });

  it("allows an explicitly selected archived Site and does not default to one", () => {
    expect(selectDashboardSite([archived])).toEqual({ kind: "no_active_sites" });
    expect(selectDashboardSite([archived], archived.site_id)).toEqual({
      kind: "selected",
      site: archived,
    });
  });

  it("distinguishes an empty registry and an unknown requested Site", () => {
    expect(selectDashboardSite([])).toEqual({ kind: "no_sites" });
    expect(selectDashboardSite([active], "site_missing")).toEqual({
      kind: "unknown",
      requestedSiteId: "site_missing",
    });
  });

  it("labels archived sites in selector options", () => {
    expect(siteOptions([active, archived])).toEqual([
      { id: "site_active", label: "Active site" },
      { id: "site_archived", label: "site_archived (archived)" },
    ]);
  });
});
