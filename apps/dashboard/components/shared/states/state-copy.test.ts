import { describe, expect, it } from "vitest";

import { dashboardStateCopy } from "./state-copy";

describe("dashboard state copy", () => {
  it("defines user-visible copy for every page state", () => {
    expect(dashboardStateCopy).toEqual({
      loading: "Loading dashboard data...",
      empty: "No page view data is available for this selection.",
      error: "Dashboard data could not be loaded.",
      success: "Dashboard data will appear here.",
    });
  });
});
