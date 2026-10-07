import React from "react";

import { dashboardStateCopy } from "./state-copy";

import type { DashboardStateContext } from "../../../lib/shared/dashboard-state";

interface ErrorStateProps {
  context?: DashboardStateContext;
  message?: string;
}

export function ErrorState({ context, message }: ErrorStateProps) {
  return (
    <>
      <p role="alert" data-site-id={context?.siteId}>
        {message ?? dashboardStateCopy.error}
      </p>
      {context ? (
        <p className="context">
          Site: {context.siteId} · {context.dateRange.from} to {context.dateRange.to} UTC
        </p>
      ) : null}
    </>
  );
}
