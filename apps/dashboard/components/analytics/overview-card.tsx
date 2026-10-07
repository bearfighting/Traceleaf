import React from "react";

import type { DashboardOverviewContext } from "../../lib/analytics/dashboard-overview";

interface OverviewCardProps {
  context: DashboardOverviewContext;
  label: string;
  pageViews: number;
}

export function OverviewCard({ context, label, pageViews }: OverviewCardProps) {
  return (
    <article className="card">
      <h2>{label}</h2>
      <p className="metric" data-page-views={pageViews}>
        {pageViews}
      </p>
      <p className="context">
        Site: {context.siteId} · {context.dateRange.from} to {context.dateRange.to} UTC
      </p>
    </article>
  );
}
