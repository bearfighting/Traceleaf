import { describe, expect, it } from "vitest";

import { formatCategoryAxisLabel } from "./chart-labels";

describe("formatCategoryAxisLabel", () => {
  it("truncates long category labels while leaving short labels unchanged", () => {
    expect(formatCategoryAxisLabel("A very long event or step name", 16)).toBe("A very long eve…");
    expect(formatCategoryAxisLabel("purchase", 16)).toBe("purchase");
  });
});
