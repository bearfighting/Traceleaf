import { describe, expect, it } from "vitest";

import { isWebVitalEvent, WEB_VITAL_RATING_THRESHOLDS, webVitalRating } from "./index";

import type { BrowserContextV1, EventBatch, PageViewEvent } from "./index";

describe("protocol types", () => {
  it("models a minimal PageViewEvent", () => {
    const event: PageViewEvent = {
      schema_version: 1,
      event_id: "01J00000000000000000000000",
      type: "page_view",
      site_id: "site_example",
      occurred_at: 1760000000000,
      path: "/about",
    };

    expect(event.type).toBe("page_view");
    expect(event.schema_version).toBe(1);
  });

  it("models a batch of PageViewEvents", () => {
    const batch: EventBatch = {
      schema_version: 1,
      events: [],
    };

    expect(batch.schema_version).toBe(1);
    expect(batch.events).toEqual([]);
  });

  it("allows only supported event variants in a batch", () => {
    // @ts-expect-error EventBatch only accepts supported event variants.
    const invalidBatch: EventBatch = {
      schema_version: 1,
      events: [{ type: "custom" }],
    };

    expect(invalidBatch.events).toHaveLength(1);
  });

  it("models the unified identity and context contract", () => {
    const context: BrowserContextV1 = {
      language: "en-CA",
      timezone: "America/Toronto",
      viewport_width: 1440,
      viewport_height: 900,
      screen_width: 2560,
      screen_height: 1440,
      user_agent: "unknown",
    };
    const event: PageViewEvent = {
      schema_version: 1,
      event_id: "01J00000000000000000000001",
      type: "page_view",
      site_id: "site_example",
      visitor_id: "550e8400-e29b-41d4-a716-446655440000",
      context_schema_version: 1,
      occurred_at: 1760000000000,
      path: "/about",
      context,
    };
    const batch: EventBatch = { schema_version: 1, events: [event] };

    expect(batch.events[0].schema_version).toBe(1);
    expect(event.context?.user_agent).toBe("unknown");
  });
});

describe("Web Vital protocol helpers", () => {
  const sample = {
    schema_version: 1,
    event_id: "01J00000000000000000000001",
    type: "web_vital",
    site_id: "site_example",
    occurred_at: 1760000000500,
    page_view_event_id: "01J00000000000000000000000",
    path: "/pricing",
    page_view_occurred_at: 1760000000000,
    metric: "LCP",
    value: 2500,
    rating: "good",
    navigation_type: "navigate",
    report_sequence: 1,
  };
  it("validates linked reports and frozen rating boundaries", () => {
    expect(WEB_VITAL_RATING_THRESHOLDS.LCP).toEqual([2500, 4000, 600000]);
    expect(isWebVitalEvent(sample)).toBe(true);
    expect(webVitalRating("LCP", 2500)).toBe("good");
    expect(webVitalRating("LCP", 2500.01)).toBe("needs_improvement");
    expect(webVitalRating("CLS", 100.01)).toBeNull();
    expect(isWebVitalEvent({ ...sample, rating: "poor" })).toBe(false);
    expect(isWebVitalEvent({ ...sample, occurred_at: -1 })).toBe(false);
    expect(isWebVitalEvent({ ...sample, page_view_occurred_at: -1 })).toBe(false);
    expect(isWebVitalEvent({ ...sample, occurred_at: sample.page_view_occurred_at - 1 })).toBe(
      false,
    );
  });
});
