import React from "react";

import { ANALYTICS_DIMENSIONS } from "../lib/analytics-api/types";

import type { AnalyticsDimension } from "../lib/analytics-api/types";
import type { DashboardDateRange } from "../lib/query-params";
import type { ReactNode } from "react";

interface DashboardShellProps {
  dateRange: DashboardDateRange;
  siteId: string;
  sites: string[];
  dimension: AnalyticsDimension;
  children: ReactNode;
  settingsMode?: boolean;
  definitionVersion?: string;
  definitionVersions?: Array<{ version: string; revision: number }>;
}

export function DashboardShell({
  dateRange,
  siteId,
  sites,
  dimension,
  children,
  settingsMode = false,
  definitionVersion,
  definitionVersions = [],
}: DashboardShellProps) {
  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Web Analytics</p>
          <h1>Dashboard</h1>
          <p>
            {settingsMode
              ? "Manage site collection and ingestion settings."
              : "Page view activity for the selected site and UTC date range."}
          </p>
        </div>
        <nav className="dashboard-nav" aria-label="Dashboard navigation">
          <a href={`/dashboard?site_id=${encodeURIComponent(siteId)}`}>Analytics</a>
          <a
            href={`/dashboard/settings?site_id=${encodeURIComponent(siteId)}`}
            aria-current={settingsMode ? "page" : undefined}
          >
            Settings
          </a>
        </nav>
        {settingsMode && (
          <form action="/dashboard/settings" method="get" className="filters">
            <label>
              Site
              <select name="site_id" defaultValue={siteId}>
                {sites.map((site) => (
                  <option key={site} value={site}>
                    {site}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Select site</button>
          </form>
        )}
        {!settingsMode && (
          <form action="/dashboard" method="get" className="filters">
            <label>
              Site
              <select name="site_id" defaultValue={siteId}>
                {sites.map((site) => (
                  <option key={site} value={site}>
                    {site}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <input name="from" type="date" defaultValue={dateRange.from} />
            </label>
            <label>
              To
              <input name="to" type="date" defaultValue={dateRange.to} />
            </label>
            <label>
              Definition revision
              <select name="definition_version" defaultValue={definitionVersion ?? ""}>
                <option value="">Current</option>
                {definitionVersions.map((item) => (
                  <option key={item.version} value={item.version}>
                    r{item.revision} · {item.version}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Dimension
              <select name="dimension" defaultValue={dimension}>
                {ANALYTICS_DIMENSIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Apply</button>
          </form>
        )}
      </header>
      {children}
    </main>
  );
}
