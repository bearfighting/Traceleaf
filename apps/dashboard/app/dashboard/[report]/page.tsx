import { notFound } from "next/navigation";

import { ANALYTICS_REPORT_COPY } from "../../../lib/analytics/analytics-report-copy";
import { DashboardRouteContent } from "../page";

import type { AnalyticsReport } from "../../../lib/settings/settings-routes";
import type { Metadata } from "next";

function isAnalyticsReport(report: string): report is AnalyticsReport {
  return Object.hasOwn(ANALYTICS_REPORT_COPY, report);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ report: string }>;
}): Promise<Metadata> {
  const { report } = await params;
  if (!isAnalyticsReport(report)) return { title: "Not Found" };

  return { title: ANALYTICS_REPORT_COPY[report].title };
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { report } = await params;
  if (!isAnalyticsReport(report)) notFound();

  return DashboardRouteContent({ searchParams, report });
}
