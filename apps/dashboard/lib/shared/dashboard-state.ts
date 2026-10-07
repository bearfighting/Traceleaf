import type { DashboardDateRange } from "../query-params";

export interface DashboardStateContext {
  siteId: string;
  dateRange: DashboardDateRange;
}

export type DashboardViewState =
  | { status: "loading"; context: DashboardStateContext }
  | { status: "empty"; context: DashboardStateContext }
  | { status: "success"; context: DashboardStateContext }
  | { status: "error"; context?: DashboardStateContext; message: string };
