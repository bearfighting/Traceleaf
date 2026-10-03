import Link from "next/link";
import React from "react";

import { ANALYTICS_DIMENSIONS } from "../lib/analytics-api/types";
import {
  analyticsReportRoute,
  settingsRoute,
  type AnalyticsReport,
  type SettingsSection,
} from "../lib/settings-routes";

import { AnalyticsSidebar } from "./analytics-sidebar";
import { Button, Select } from "./ui";

import type { AnalyticsDimension } from "../lib/analytics-api/types";
import type { DashboardDateRange } from "../lib/query-params";
import type { ReactNode } from "react";

interface DashboardShellProps {
  dateRange: DashboardDateRange;
  siteId: string;
  sites: Array<{ id: string; label: string }>;
  dimension: AnalyticsDimension;
  children: ReactNode;
  settingsMode?: boolean;
  definitionVersion?: string;
  definitionVersions?: Array<{ version: string; revision: number }>;
  environment?: string;
  settingsSection?: SettingsSection;
  report?: string;
}

const reportTitles: Record<string, { title: string; description: string }> = {
  overview: {
    title: "Overview",
    description: "Key activity for the selected site and reporting period.",
  },
  pages: { title: "Pages", description: "Page view trends and the most visited paths." },
  dimensions: {
    title: "Dimensions",
    description: "Break down activity by browser, device, and other dimensions.",
  },
  visitors: { title: "Visitors", description: "Daily unique visitor activity for this site." },
  sessions: { title: "Sessions", description: "Daily session activity for this site." },
  "custom-events": {
    title: "Custom events",
    description: "Events recorded for the selected site and period.",
  },
  "web-vitals": {
    title: "Web Vitals",
    description: "Browser performance metrics for the selected period.",
  },
  countries: { title: "Countries", description: "Geographic distribution of activity by country." },
  conversions: {
    title: "Conversions",
    description: "Conversion outcomes for the selected definition revision.",
  },
  funnels: {
    title: "Funnels",
    description: "Funnel completion by step for the selected definition revision.",
  },
};

function analyticsUrl({
  report,
  siteId,
  dateRange,
  dimension,
  definitionVersion,
  environment,
}: Pick<
  DashboardShellProps,
  "siteId" | "dateRange" | "dimension" | "definitionVersion" | "environment"
> & { report: AnalyticsReport }) {
  return analyticsReportRoute(report, {
    siteId,
    from: dateRange.from,
    to: dateRange.to,
    dimension,
    definitionVersion,
    environment,
  });
}

function settingsUrl({
  siteId,
  dateRange,
  dimension,
  definitionVersion,
  environment,
  settingsSection = "overview",
}: Pick<DashboardShellProps, "siteId" | "dateRange" | "environment" | "settingsSection"> &
  Partial<Pick<DashboardShellProps, "dimension" | "definitionVersion">>) {
  return settingsRoute(settingsSection, {
    siteId,
    from: dateRange.from,
    to: dateRange.to,
    dimension,
    definitionVersion,
    environment,
  });
}

export function DashboardHeader({
  siteId,
  settingsMode,
  analyticsHref,
  settingsHref,
}: {
  siteId?: string;
  settingsMode?: boolean;
  analyticsHref?: string;
  settingsHref?: string;
}) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="dashboard-container flex min-h-[76px] flex-wrap items-center justify-between gap-4 py-3">
        <Link
          aria-label="Web Analytics home"
          className="flex items-center gap-3 no-underline"
          href={analyticsHref ?? "/dashboard"}
        >
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-xl bg-brand text-base font-bold text-white shadow-sm"
          >
            W
          </span>
          <span className="grid gap-0.5">
            <span className="text-sm font-bold tracking-tight text-ink">Web Analytics</span>
            <span className="text-xs text-muted">Platform</span>
          </span>
        </Link>
        <nav aria-label="Primary navigation" className="dashboard-nav">
          <Link
            aria-current={!settingsMode ? "page" : undefined}
            href={analyticsHref ?? "/dashboard"}
          >
            Analytics
          </Link>
          <Link
            aria-current={settingsMode ? "page" : undefined}
            href={
              settingsHref ??
              (siteId ? settingsRoute("overview", { siteId }) : settingsRoute("overview"))
            }
          >
            Settings
          </Link>
        </nav>
      </div>
    </header>
  );
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
  environment,
  settingsSection = "overview",
  report = "overview",
}: DashboardShellProps) {
  const reportInfo = reportTitles[report] ?? reportTitles.overview;
  const analyticsHref = analyticsUrl({
    report: "overview",
    siteId,
    dateRange,
    dimension,
    definitionVersion,
    environment,
  });
  const settingsHref = settingsUrl({
    siteId,
    dateRange,
    dimension: settingsMode && settingsSection === "definitions" ? dimension : undefined,
    definitionVersion:
      settingsMode && settingsSection === "definitions" ? definitionVersion : undefined,
    environment,
    settingsSection,
  });
  const sidebarSearch = settingsUrl({
    siteId,
    dateRange,
    dimension,
    definitionVersion,
    environment,
  }).split("?")[1];

  return (
    <main className="dashboard-shell bg-canvas text-ink">
      <DashboardHeader
        siteId={siteId}
        settingsMode={settingsMode}
        analyticsHref={analyticsHref}
        settingsHref={settingsHref}
      />
      <div
        className={`dashboard-container grid gap-8 py-8 lg:gap-10 ${settingsMode ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]"}`}
      >
        {!settingsMode && (
          <AnalyticsSidebar
            pathname={report === "overview" ? "/dashboard" : `/dashboard/${report}`}
            search={sidebarSearch}
          />
        )}
        <div className="min-w-0">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="eyebrow">{settingsMode ? "Workspace" : "Analytics"}</p>
              <h1 className="m-0 text-3xl font-bold tracking-tight text-ink">
                {settingsMode ? "Site settings" : reportInfo.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                {settingsMode
                  ? "Manage capabilities, ingestion, and analytics definitions for a site."
                  : reportInfo.description}
              </p>
            </div>
          </div>

          {settingsMode ? (
            <form
              action={`/dashboard/settings/${settingsSection}`}
              className="filters mb-6"
              method="get"
            >
              <label>
                Site
                <Select defaultValue={siteId} name="site_id">
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.label}
                    </option>
                  ))}
                </Select>
              </label>
              {dateRange.from && <input name="from" type="hidden" value={dateRange.from} />}
              {dateRange.to && <input name="to" type="hidden" value={dateRange.to} />}
              {dimension && <input name="dimension" type="hidden" value={dimension} />}
              {definitionVersion && (
                <input name="definition_version" type="hidden" value={definitionVersion} />
              )}
              {environment && <input name="environment" type="hidden" value={environment} />}
              <Button type="submit">Select site</Button>
            </form>
          ) : (
            <form
              action={report === "overview" ? "/dashboard" : `/dashboard/${report}`}
              className="filters mb-6 rounded-xl border border-line bg-surface p-4 shadow-sm"
              method="get"
            >
              <label>
                Site
                <Select defaultValue={siteId} name="site_id">
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                From
                <input defaultValue={dateRange.from} name="from" type="date" />
              </label>
              <label>
                To
                <input defaultValue={dateRange.to} name="to" type="date" />
              </label>
              {(report === "conversions" || report === "funnels") && (
                <label>
                  Definition revision
                  <Select defaultValue={definitionVersion ?? ""} name="definition_version">
                    <option value="">Current</option>
                    {definitionVersions.map((item) => (
                      <option key={item.version} value={item.version}>
                        r{item.revision} · {item.version}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {report === "dimensions" && (
                <label>
                  Dimension
                  <Select defaultValue={dimension} name="dimension">
                    {ANALYTICS_DIMENSIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {environment && <input name="environment" type="hidden" value={environment} />}
              <Button type="submit">Apply filters</Button>
            </form>
          )}

          {children}
        </div>
      </div>
    </main>
  );
}
