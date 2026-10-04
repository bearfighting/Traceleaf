import type { AnalyticsReport } from "./settings-routes";

export const ANALYTICS_REPORT_COPY: Record<
  AnalyticsReport,
  { title: string; description: string }
> = {
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

export function getAnalyticsReportCopy(report: string) {
  return Object.hasOwn(ANALYTICS_REPORT_COPY, report)
    ? ANALYTICS_REPORT_COPY[report as AnalyticsReport]
    : ANALYTICS_REPORT_COPY.overview;
}
