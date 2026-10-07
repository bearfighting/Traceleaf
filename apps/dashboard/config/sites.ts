import type { ManagedSite } from "../lib/sites/site-management/client";

export type SiteSelection =
  | { kind: "selected"; site: ManagedSite }
  | { kind: "unknown"; requestedSiteId: string }
  | { kind: "no_sites" }
  | { kind: "no_active_sites" };

export function selectDashboardSite(
  sites: readonly ManagedSite[],
  requestedSiteId?: string,
): SiteSelection {
  if (requestedSiteId) {
    const requested = sites.find((site) => site.site_id === requestedSiteId);

    return requested ? { kind: "selected", site: requested } : { kind: "unknown", requestedSiteId };
  }
  if (sites.length === 0) return { kind: "no_sites" };
  const firstActive = sites.find((site) => site.lifecycle_status === "active");

  return firstActive ? { kind: "selected", site: firstActive } : { kind: "no_active_sites" };
}

export function siteOptions(sites: readonly ManagedSite[]): Array<{ id: string; label: string }> {
  return sites.map((site) => ({
    id: site.site_id,
    label: `${site.display_name || site.site_id}${site.lifecycle_status === "archived" ? " (archived)" : ""}`,
  }));
}
