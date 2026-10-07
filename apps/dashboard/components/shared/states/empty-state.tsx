import React from "react";

import { dashboardStateCopy } from "./state-copy";

import type { DashboardStateContext } from "../../../lib/shared/dashboard-state";

interface EmptyStateProps {
  context: DashboardStateContext;
  message?: string;
}

export function EmptyState({ context, message = dashboardStateCopy.empty }: EmptyStateProps) {
  return <p data-site-id={context.siteId}>{message}</p>;
}
