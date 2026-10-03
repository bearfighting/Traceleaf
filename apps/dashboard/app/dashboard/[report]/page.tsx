import { notFound } from "next/navigation";

import { DashboardRouteContent } from "../page";

const reports = new Set([
  "pages",
  "dimensions",
  "visitors",
  "sessions",
  "custom-events",
  "web-vitals",
  "countries",
  "conversions",
  "funnels",
]);

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { report } = await params;
  if (!reports.has(report)) notFound();

  return DashboardRouteContent({ searchParams, report });
}
