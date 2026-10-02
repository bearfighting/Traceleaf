"use client";

import { useEffect, useState } from "react";

interface SidebarItem {
  id: string;
  label: string;
}

interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

const groups: SidebarGroup[] = [
  { label: "Overview", items: [{ id: "overview", label: "Overview" }] },
  {
    label: "Traffic",
    items: [
      { id: "timeline", label: "Page views" },
      { id: "top-pages", label: "Top pages" },
      { id: "dimensions", label: "Dimensions" },
    ],
  },
  {
    label: "Audience",
    items: [
      { id: "visitors", label: "Visitors" },
      { id: "sessions", label: "Sessions" },
    ],
  },
  { label: "Engagement", items: [{ id: "custom-events", label: "Custom events" }] },
  { label: "Experience", items: [{ id: "web-vitals", label: "Web Vitals" }] },
  { label: "Geography", items: [{ id: "countries", label: "Countries" }] },
  {
    label: "Outcomes",
    items: [
      { id: "conversions", label: "Conversions" },
      { id: "funnels", label: "Funnels" },
    ],
  },
];

function SidebarLinks({
  activeId,
  onSelect,
  closeOnSelect = false,
}: {
  activeId: string;
  onSelect: (id: string) => void;
  closeOnSelect?: boolean;
}) {
  return (
    <nav aria-label="Analytics reports" className="analytics-sidebar-nav">
      {groups.map((group) => (
        <div className="analytics-sidebar-group" key={group.label}>
          {group.items.length > 1 && <p className="analytics-sidebar-heading">{group.label}</p>}
          {group.items.map((item) => (
            <a
              aria-current={activeId === item.id ? "location" : undefined}
              className="analytics-sidebar-link"
              href={`#${item.id}`}
              key={item.id}
              onClick={(event) => {
                onSelect(item.id);
                if (closeOnSelect) {
                  const details = event.currentTarget.closest("details");
                  if (details) {
                    details.open = false;
                    details.querySelector("summary")?.focus();
                  }
                }
              }}
            >
              {item.label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AnalyticsSidebar() {
  const [activeId, setActiveId] = useState("overview");

  useEffect(() => {
    const readHash = () => {
      const hashId = window.location.hash.slice(1);
      setActiveId(
        groups.flatMap((group) => group.items).some((item) => item.id === hashId)
          ? hashId
          : "overview",
      );
    };

    readHash();
    window.addEventListener("hashchange", readHash);
    window.addEventListener("popstate", readHash);

    return () => {
      window.removeEventListener("hashchange", readHash);
      window.removeEventListener("popstate", readHash);
    };
  }, []);

  return (
    <aside aria-label="Analytics navigation" className="analytics-sidebar">
      <div className="analytics-sidebar-desktop">
        <SidebarLinks activeId={activeId} onSelect={setActiveId} />
      </div>
      <details className="mobile-analytics-menu">
        <summary>Browse reports</summary>
        <SidebarLinks activeId={activeId} onSelect={setActiveId} closeOnSelect />
      </details>
    </aside>
  );
}
