import { describe, expect, it } from "vitest";

import {
  DAILY_PAGE_VIEWS,
  SELECTED_RANGE_PAGE_VIEWS,
  SITE_TOTAL_PAGE_VIEWS,
  TOP_PAGE_BAR_WIDTHS,
  TOP_PAGES,
  createPreviewTrendPoints,
  formatPreviewDate,
  formatPreviewDateRange,
} from "./product-preview-data";

describe("product preview sample data", () => {
  it("sums the selected date range from its daily values", () => {
    expect(SELECTED_RANGE_PAGE_VIEWS).toBe(8_492);
    expect(DAILY_PAGE_VIEWS.reduce((sum, item) => sum + item.page_views, 0)).toBe(8_492);
    expect(SITE_TOTAL_PAGE_VIEWS).toBe(24_680);
  });

  it("keeps the daily values mapped to ascending UTC dates", () => {
    expect(DAILY_PAGE_VIEWS).toEqual([
      { day: "2026-10-10", page_views: 1_012 },
      { day: "2026-10-11", page_views: 1_098 },
      { day: "2026-10-12", page_views: 1_136 },
      { day: "2026-10-13", page_views: 1_194 },
      { day: "2026-10-14", page_views: 1_248 },
      { day: "2026-10-15", page_views: 1_320 },
      { day: "2026-10-16", page_views: 1_484 },
    ]);
    expect(DAILY_PAGE_VIEWS.map(({ day }) => day)).toEqual(
      [...DAILY_PAGE_VIEWS.map(({ day }) => day)].sort(),
    );
    expect(DAILY_PAGE_VIEWS.map(({ day }) => formatPreviewDate(day, "English"))).toEqual([
      "Sat",
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
    ]);
  });

  it("formats the fixed sample range from its first and last UTC dates", () => {
    expect(formatPreviewDateRange(DAILY_PAGE_VIEWS, "English")).toBe("Oct 10–16, 2026");
    expect(formatPreviewDateRange(DAILY_PAGE_VIEWS, "简体中文")).toBe("2026年10月10日–16日");
    expect(formatPreviewDateRange([], "English")).toBe("");
    expect(formatPreviewDateRange([{ day: "2026-10-10", page_views: 1 }], "English")).toBe(
      "Oct 10, 2026",
    );
    expect(formatPreviewDateRange([{ day: "2026-10-10", page_views: 1 }], "简体中文")).toBe(
      "2026年10月10日",
    );
  });

  it("formats ranges across month and year boundaries", () => {
    expect(
      formatPreviewDateRange(
        [
          { day: "2026-12-30", page_views: 1 },
          { day: "2027-01-02", page_views: 1 },
        ],
        "English",
      ),
    ).toBe("Dec 30, 2026–Jan 2, 2027");
    expect(
      formatPreviewDateRange(
        [
          { day: "2026-12-30", page_views: 1 },
          { day: "2027-01-02", page_views: 1 },
        ],
        "简体中文",
      ),
    ).toBe("2026年12月30日–2027年1月2日");
  });

  it("rejects impossible calendar dates", () => {
    expect(() =>
      formatPreviewDateRange(
        [
          { day: "2026-02-30", page_views: 1 },
          { day: "2026-03-01", page_views: 1 },
        ],
        "English",
      ),
    ).toThrow(RangeError);
  });

  it("sorts top pages by views and derives bar widths from their values", () => {
    expect(TOP_PAGES.map(({ page_views }) => page_views)).toEqual([2_841, 1_624, 986]);
    expect(TOP_PAGE_BAR_WIDTHS.map(({ width }) => width)).toEqual(["100%", "57%", "35%"]);
    for (const page of TOP_PAGE_BAR_WIDTHS) {
      expect(Number.parseFloat(page.width)).toBe(
        Math.round((page.page_views / TOP_PAGES[0].page_views) * 100),
      );
    }
  });

  it("places every daily value on the chart within the date and quantity axes", () => {
    const points = createPreviewTrendPoints();

    expect(points).toHaveLength(DAILY_PAGE_VIEWS.length);
    expect(points[0].x).toBe(54);
    expect(points.at(-1)?.x).toBe(426);
    expect(points[0].y).toBeGreaterThan(20);
    expect(points.at(-1)?.y).toBeLessThan(55);
    expect(points.every(({ x, y }) => x >= 54 && x <= 426 && y >= 20 && y <= 125)).toBe(true);
  });
});
