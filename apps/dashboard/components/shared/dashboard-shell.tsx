import Link from "next/link";
import React from "react";

import { ANALYTICS_DIMENSIONS } from "../../lib/analytics/analytics-api/types";
import { getAnalyticsReportCopy } from "../../lib/analytics/analytics-report-copy";
import {
  analyticsReportRoute,
  settingsRoute,
  type AnalyticsReport,
  type SettingsSection,
} from "../../lib/settings/settings-routes";
import * as UI from "../ui/index";
import { Button, Select } from "../ui/index";

import { AnalyticsSidebar } from "./analytics-sidebar";

import type { AnalyticsDimension } from "../../lib/analytics/analytics-api/types";
import type { DashboardDateRange } from "../../lib/query-params";
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
    <header className="dashboard-topbar">
      <div className="dashboard-container dashboard-topbar-inner">
        <Link
          aria-label="Web Analytics home"
          className="brand-link"
          href={analyticsHref ?? "/dashboard"}
        >
          <span aria-hidden="true" className="brand-mark">
            W
          </span>
          <span className="brand-copy">
            <span className="brand-name">Web Analytics</span>
            <span className="brand-tagline">Platform</span>
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
          <Link className="add-site-link" href="/dashboard/sites/new">
            Add a Site
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
  const reportInfo = getAnalyticsReportCopy(report);
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
    <main className="dashboard-shell">
      <DashboardHeader
        siteId={siteId}
        settingsMode={settingsMode}
        analyticsHref={analyticsHref}
        settingsHref={settingsHref}
      />
      <div
        className={`dashboard-container dashboard-layout ${settingsMode ? "dashboard-layout-settings" : "dashboard-layout-analytics"}`}
      >
        {!settingsMode && (
          <AnalyticsSidebar
            pathname={report === "overview" ? "/dashboard" : `/dashboard/${report}`}
            search={sidebarSearch}
          />
        )}
        <div className="dashboard-content-main">
          <div className="dashboard-page-heading">
            <div>
              <p className="eyebrow">{settingsMode ? "Workspace" : "Analytics"}</p>
              <h1 className="page-title">{settingsMode ? "Site settings" : reportInfo.title}</h1>
              <p className="page-description">
                {settingsMode
                  ? "Manage capabilities, ingestion, and analytics definitions for a site."
                  : reportInfo.description}
              </p>
            </div>
          </div>

          {settingsMode ? (
            <form
              action={`/dashboard/settings/${settingsSection}`}
              className="filters site-selector-form"
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
              {dateRange.from && <UI.Input name="from" type="hidden" value={dateRange.from} />}
              {dateRange.to && <UI.Input name="to" type="hidden" value={dateRange.to} />}
              {dimension && <UI.Input name="dimension" type="hidden" value={dimension} />}
              {definitionVersion && (
                <UI.Input name="definition_version" type="hidden" value={definitionVersion} />
              )}
              {environment && <UI.Input name="environment" type="hidden" value={environment} />}
              <Button type="submit">Select site</Button>
            </form>
          ) : (
            <form
              action={report === "overview" ? "/dashboard" : `/dashboard/${report}`}
              className="filters analytics-filters"
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
                <UI.DatePicker defaultValue={dateRange.from} name="from" />
              </label>
              <label>
                To
                <UI.DatePicker defaultValue={dateRange.to} name="to" />
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
              {environment && <UI.Input name="environment" type="hidden" value={environment} />}
              <Button type="submit">Apply filters</Button>
            </form>
          )}

          {children}
        </div>
      </div>
    </main>
  );
}
