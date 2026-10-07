import Link from "next/link";

import { analyticsReportRoute, type AnalyticsReport } from "../../lib/settings/settings-routes";

interface SidebarItem {
  id: string;
  label: string;
  href: AnalyticsReport;
}

interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

const groups: SidebarGroup[] = [
  { label: "Overview", items: [{ id: "overview", label: "Overview", href: "overview" }] },
  {
    label: "Traffic",
    items: [
      { id: "pages", label: "Pages", href: "pages" },
      { id: "dimensions", label: "Dimensions", href: "dimensions" },
    ],
  },
  {
    label: "Audience",
    items: [
      { id: "visitors", label: "Visitors", href: "visitors" },
      { id: "sessions", label: "Sessions", href: "sessions" },
    ],
  },
  {
    label: "Engagement",
    items: [{ id: "custom-events", label: "Custom events", href: "custom-events" }],
  },
  {
    label: "Experience",
    items: [{ id: "web-vitals", label: "Web Vitals", href: "web-vitals" }],
  },
  {
    label: "Geography",
    items: [{ id: "countries", label: "Countries", href: "countries" }],
  },
  {
    label: "Outcomes",
    items: [
      { id: "conversions", label: "Conversions", href: "conversions" },
      { id: "funnels", label: "Funnels", href: "funnels" },
    ],
  },
];

function SidebarLinks({
  activePath,
  hrefFor,
}: {
  activePath: string;
  hrefFor: (href: AnalyticsReport) => string;
}) {
  return (
    <nav aria-label="Analytics reports" className="analytics-sidebar-nav">
      {groups.map((group) => (
        <div className="analytics-sidebar-group" key={group.label}>
          {group.items.length > 1 && <p className="analytics-sidebar-heading">{group.label}</p>}
          {group.items.map((item) => (
            <Link
              aria-current={
                activePath === (item.href === "overview" ? "/dashboard" : `/dashboard/${item.href}`)
                  ? "page"
                  : undefined
              }
              className="analytics-sidebar-link"
              href={hrefFor(item.href)}
              key={item.id}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AnalyticsSidebar({
  pathname = "/dashboard",
  search,
}: {
  pathname?: string;
  search?: string;
}) {
  const searchParams = new URLSearchParams(search);
  const context = {
    siteId: searchParams.get("site_id") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    environment: searchParams.get("environment") ?? undefined,
    dimension: searchParams.get("dimension") ?? undefined,
    definitionVersion: searchParams.get("definition_version") ?? undefined,
  };
  const hrefFor = (report: AnalyticsReport) => analyticsReportRoute(report, context);

  return (
    <aside aria-label="Analytics navigation" className="analytics-sidebar">
      <div className="analytics-sidebar-desktop">
        <SidebarLinks activePath={pathname} hrefFor={hrefFor} />
      </div>
      <details className="mobile-analytics-menu">
        <summary>Browse reports</summary>
        <SidebarLinks activePath={pathname} hrefFor={hrefFor} />
      </details>
    </aside>
  );
}
