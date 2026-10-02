import Link from "next/link";

import { settingsRoute, type SettingsRouteContext } from "../lib/settings-routes";

import type { ManagedSite } from "../lib/site-management/client";

export function SettingsNavigation({
  site,
  environment,
  context,
}: {
  site?: ManagedSite;
  environment?: string;
  context: SettingsRouteContext;
}) {
  const siteLabel = site?.display_name || site?.site_id || "Site";

  return (
    <div className="mb-6 grid gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href={settingsRoute("overview", context)}>Settings</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Overview</span>
        {site && <span> · {siteLabel}</span>}
        {environment && <span> · {environment}</span>}
      </nav>
      <nav aria-label="Settings navigation" className="dashboard-nav">
        <Link aria-current="page" href={settingsRoute("overview", context)}>
          Overview
        </Link>
      </nav>
    </div>
  );
}
