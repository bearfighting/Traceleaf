export const WEB_VITAL_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type WebVitalMetric = (typeof WEB_VITAL_METRICS)[number];
export type WebVitalRating = "good" | "needs_improvement" | "poor";
export type WebVitalNavigationType = "navigate" | "reload" | "back_forward" | "prerender";
export interface WebVitalEvent {
  schema_version: 1;
  event_id: string;
  type: "web_vital";
  site_id: string;
  occurred_at: number;
  page_view_event_id: string;
  path: string;
  page_view_occurred_at: number;
  metric: WebVitalMetric;
  value: number;
  rating: WebVitalRating;
  navigation_type: WebVitalNavigationType;
  report_sequence: number;
}
export const WEB_VITAL_RATING_THRESHOLDS: Record<
  WebVitalMetric,
  readonly [good: number, needsImprovement: number, maximum: number]
> = {
  LCP: [2500, 4000, 600000],
  INP: [200, 500, 600000],
  CLS: [0.1, 0.25, 100],
  FCP: [1800, 3000, 600000],
  TTFB: [800, 1800, 600000],
};
export function webVitalRating(metric: WebVitalMetric, value: number): WebVitalRating | null {
  const [good, needs, max] = WEB_VITAL_RATING_THRESHOLDS[metric];
  if (!Number.isFinite(value) || value < 0 || value > max) return null;

  return value <= good ? "good" : value <= needs ? "needs_improvement" : "poor";
}
export function isWebVitalEvent(value: unknown): value is WebVitalEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<WebVitalEvent>;

  return (
    e.schema_version === 1 &&
    e.type === "web_vital" &&
    typeof e.event_id === "string" &&
    typeof e.site_id === "string" &&
    typeof e.page_view_event_id === "string" &&
    typeof e.path === "string" &&
    e.path.startsWith("/") &&
    Number.isSafeInteger(e.occurred_at) &&
    (e.occurred_at ?? -1) >= 0 &&
    Number.isSafeInteger(e.page_view_occurred_at) &&
    (e.page_view_occurred_at ?? -1) >= 0 &&
    (e.page_view_occurred_at ?? Infinity) <= (e.occurred_at ?? -Infinity) &&
    WEB_VITAL_METRICS.includes(e.metric as WebVitalMetric) &&
    e.rating === webVitalRating(e.metric as WebVitalMetric, e.value as number) &&
    ["navigate", "reload", "back_forward", "prerender"].includes(e.navigation_type ?? "") &&
    Number.isSafeInteger(e.report_sequence) &&
    (e.report_sequence ?? 0) > 0
  );
}
