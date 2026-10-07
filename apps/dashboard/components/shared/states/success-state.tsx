import { dashboardStateCopy } from "./state-copy";

import type { DashboardStateContext } from "../../../lib/shared/dashboard-state";

interface SuccessStateProps {
  context: DashboardStateContext;
}

export function SuccessState({ context }: SuccessStateProps) {
  return <p data-site-id={context.siteId}>{dashboardStateCopy.success}</p>;
}
