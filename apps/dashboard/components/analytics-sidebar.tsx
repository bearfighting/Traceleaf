import Link from "next/link";

interface SidebarItem {
  id: string;
  label: string;
  href: string;
}

interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

const groups: SidebarGroup[] = [
  { label: "Overview", items: [{ id: "overview", label: "Overview", href: "/dashboard" }] },
  {
    label: "Traffic",
    items: [
      { id: "pages", label: "Pages", href: "/dashboard/pages" },
      { id: "dimensions", label: "Dimensions", href: "/dashboard/dimensions" },
    ],
  },
  {
    label: "Audience",
    items: [
      { id: "visitors", label: "Visitors", href: "/dashboard/visitors" },
      { id: "sessions", label: "Sessions", href: "/dashboard/sessions" },
    ],
  },
  {
    label: "Engagement",
    items: [{ id: "custom-events", label: "Custom events", href: "/dashboard/custom-events" }],
  },
  {
    label: "Experience",
    items: [{ id: "web-vitals", label: "Web Vitals", href: "/dashboard/web-vitals" }],
  },
  {
    label: "Geography",
    items: [{ id: "countries", label: "Countries", href: "/dashboard/countries" }],
  },
  {
    label: "Outcomes",
    items: [
      { id: "conversions", label: "Conversions", href: "/dashboard/conversions" },
      { id: "funnels", label: "Funnels", href: "/dashboard/funnels" },
    ],
  },
];

function SidebarLinks({
  activePath,
  hrefFor,
}: {
  activePath: string;
  hrefFor: (href: string) => string;
}) {
  return (
    <nav aria-label="Analytics reports" className="analytics-sidebar-nav">
      {groups.map((group) => (
        <div className="analytics-sidebar-group" key={group.label}>
          {group.items.length > 1 && <p className="analytics-sidebar-heading">{group.label}</p>}
          {group.items.map((item) => (
            <Link
              aria-current={activePath === item.href ? "page" : undefined}
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
  const hrefFor = (href: string) => `${href}${search ? `?${search}` : ""}`;

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
