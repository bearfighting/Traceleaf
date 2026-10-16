export interface DailyPageViews {
  day: string;
  page_views: number;
}

export interface TopPageViews {
  path: string;
  page_views: number;
}

export interface PreviewTrendPoint {
  x: number;
  y: number;
}

const CHART_PLOT_LEFT = 54;
const CHART_PLOT_RIGHT = 426;
const CHART_PLOT_TOP = 20;
const CHART_PLOT_BOTTOM = 125;
const CHART_VALUE_MIN = 750;
const CHART_VALUE_MAX = 1_500;

export const SITE_TOTAL_PAGE_VIEWS = 24_680;

export const DAILY_PAGE_VIEWS: DailyPageViews[] = [
  { day: "2026-10-10", page_views: 1_012 },
  { day: "2026-10-11", page_views: 1_098 },
  { day: "2026-10-12", page_views: 1_136 },
  { day: "2026-10-13", page_views: 1_194 },
  { day: "2026-10-14", page_views: 1_248 },
  { day: "2026-10-15", page_views: 1_320 },
  { day: "2026-10-16", page_views: 1_484 },
];

export const TOP_PAGES: TopPageViews[] = [
  { path: "/", page_views: 2_841 },
  { path: "/docs/getting-started", page_views: 1_624 },
  { path: "/pricing", page_views: 986 },
];

export const SELECTED_RANGE_PAGE_VIEWS = DAILY_PAGE_VIEWS.reduce(
  (total, item) => total + item.page_views,
  0,
);

export function createPreviewTrendPoints(
  dailyPageViews: readonly DailyPageViews[] = DAILY_PAGE_VIEWS,
): PreviewTrendPoint[] {
  if (dailyPageViews.length < 2) {
    return dailyPageViews.map(() => ({
      x: (CHART_PLOT_LEFT + CHART_PLOT_RIGHT) / 2,
      y: CHART_PLOT_BOTTOM,
    }));
  }

  return dailyPageViews.map((item, index) => ({
    x:
      CHART_PLOT_LEFT +
      ((CHART_PLOT_RIGHT - CHART_PLOT_LEFT) / (dailyPageViews.length - 1)) * index,
    y:
      CHART_PLOT_BOTTOM -
      ((item.page_views - CHART_VALUE_MIN) / (CHART_VALUE_MAX - CHART_VALUE_MIN)) *
        (CHART_PLOT_BOTTOM - CHART_PLOT_TOP),
  }));
}

export const TOP_PAGE_BAR_WIDTHS = TOP_PAGES.map((page) => ({
  ...page,
  width: `${Math.round((page.page_views / TOP_PAGES[0].page_views) * 100)}%`,
}));

export function formatPreviewDate(day: string, localeName: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat(localeName === "English" ? "en-US" : "zh-CN", {
    timeZone: "UTC",
    weekday: "short",
  }).format(date);
}

export function formatPreviewDateRange(
  dailyPageViews: readonly DailyPageViews[],
  localeName: string,
): string {
  const firstDay = dailyPageViews[0]?.day;
  const lastDay = dailyPageViews.at(-1)?.day;

  if (!firstDay || !lastDay) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat(localeName === "English" ? "en-US" : "zh-CN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });

  return formatter.formatRange(new Date(`${firstDay}T00:00:00Z`), new Date(`${lastDay}T00:00:00Z`));
}
