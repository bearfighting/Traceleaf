import Link from "next/link";

import { settingsRoute, type SettingsRouteContext } from "../lib/settings-routes";

import type { ManagedSite } from "../lib/site-management/client";

export function SettingsNavigation({
  site,
  environment,
  context,
  section = "overview",
}: {
  site?: ManagedSite;
  environment?: string;
  context: SettingsRouteContext;
  section?: "overview" | "capabilities" | "environments" | "ingest-keys";
}) {
  const siteLabel = site?.display_name || site?.site_id || "Site";
  const currentEnvironment = environment ?? context.environment;
  const current =
    section === "capabilities"
      ? "Capabilities"
      : section === "environments"
        ? "Environments & Origins"
        : section === "ingest-keys"
          ? "Ingest Keys"
          : "Overview";

  return (
    <div className="mb-6 grid gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href={settingsRoute("overview", context)}>Settings</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{current}</span>
        {site && <span> · {siteLabel}</span>}
        {currentEnvironment && <span> · {currentEnvironment}</span>}
      </nav>
      <nav aria-label="Settings navigation" className="dashboard-nav">
        {(["overview", "capabilities", "environments", "ingest-keys"] as const).map((item) => {
          const label =
            item === "environments"
              ? "Environments & Origins"
              : item === "capabilities"
                ? "Capabilities"
                : item === "ingest-keys"
                  ? "Ingest Keys"
                  : "Overview";

          return (
            <Link
              key={item}
              aria-current={section === item ? "page" : undefined}
              href={settingsRoute(item, context)}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
