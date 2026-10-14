import React from "react";

import type { DashboardOverviewContext } from "../../lib/analytics/dashboard-overview";

interface OverviewCardProps {
  context: DashboardOverviewContext;
  label: string;
  metric: "page_views" | "unique_visitors" | "sessions";
  value: number;
}

export function OverviewCard({ context, label, metric, value }: OverviewCardProps) {
  return (
    <article className="card">
      <h2>{label}</h2>
      <p className="metric" data-metric={metric} data-value={value}>
        {value}
      </p>
      <p className="context">
        Site: {context.siteId} · {context.dateRange.from} to {context.dateRange.to} UTC
      </p>
    </article>
  );
}
