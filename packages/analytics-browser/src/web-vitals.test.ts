import { MemoryNavigationObserver } from "@web-analytics/observer-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAnalytics } from "./analytics";

import type { AnalyticsEvent } from "@web-analytics/protocol-ts";
import type { Metric } from "web-vitals";

type TestMetric = Pick<Metric, "name" | "value" | "navigationType">;

const callbacks = vi.hoisted(() => ({
  LCP: undefined as ((metric: TestMetric) => void) | undefined,
  INP: undefined as ((metric: TestMetric) => void) | undefined,
  CLS: undefined as ((metric: TestMetric) => void) | undefined,
  FCP: undefined as ((metric: TestMetric) => void) | undefined,
  TTFB: undefined as ((metric: TestMetric) => void) | undefined,
}));
vi.mock("web-vitals", () => ({
  onLCP: (cb: (metric: TestMetric) => void) => {
    callbacks.LCP = cb;
  },
  onINP: (cb: (metric: TestMetric) => void) => {
    callbacks.INP = cb;
  },
  onCLS: (cb: (metric: TestMetric) => void) => {
    callbacks.CLS = cb;
  },
  onFCP: (cb: (metric: TestMetric) => void) => {
    callbacks.FCP = cb;
  },
  onTTFB: (cb: (metric: TestMetric) => void) => {
    callbacks.TTFB = cb;
  },
}));

describe("Browser Web Vitals collection", () => {
  beforeEach(() => {
    callbacks.LCP = callbacks.INP = callbacks.CLS = callbacks.FCP = callbacks.TTFB = undefined;
  });
  it("only listens with granted consent, correlates reports, and keepalive flushes when hidden", async () => {
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal("window", {
      location: { href: "https://example.test/start", pathname: "/start" },
      addEventListener: (name: string, cb: () => void) => {
        listeners[`window:${name}`] = cb;
      },
      removeEventListener: vi.fn(),
    });
    const doc = {
      title: "Start",
      referrer: "",
      visibilityState: "visible",
      addEventListener: (name: string, cb: () => void) => {
        listeners[`document:${name}`] = cb;
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("document", doc);
    const sent: Array<{ events: readonly AnalyticsEvent[]; options?: { keepalive?: boolean } }> =
      [];
    let sequence = 0;
    const analytics = createAnalytics({
      siteId: "site_example",
      consent: "granted",
      bufferSize: 1,
      createEventId: () => `01J0000000000000000000000${String(++sequence).padStart(1, "0")}`,
      now: () => 1760000000100,
      contextProvider: {
        getContext: () => ({
          language: "unknown",
          timezone: "unknown",
          viewport_width: "unknown",
          viewport_height: "unknown",
          screen_width: "unknown",
          screen_height: "unknown",
          user_agent: "unknown",
        }),
      },
      transport: {
        async sendBatch(events, options) {
          sent.push({ events, options });
        },
      },
    });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);
    observer.emit({
      url: "https://example.test/start",
      path: "/start",
      title: "Start",
      navigationType: "initial",
      occurredAt: 1760000000000,
    });
    expect(callbacks.LCP).toBeDefined();
    doc.visibilityState = "hidden";
    listeners["document:visibilitychange"]?.();
    // web-vitals can report its final metric later in the same visibility event.
    callbacks.LCP?.({ name: "LCP", value: 2500, navigationType: "navigate" });
    await Promise.resolve();
    await analytics.flush();
    const vital = sent.flatMap((batch) => batch.events).find((event) => event.type === "web_vital");
    expect(vital).toMatchObject({
      type: "web_vital",
      metric: "LCP",
      rating: "good",
      path: "/start",
      page_view_occurred_at: 1760000000100,
    });
    expect("visitor_id" in (vital as object)).toBe(false);
    expect(
      sent.find((batch) => batch.events.some((event) => event.type === "web_vital"))?.options
        ?.keepalive,
    ).toBe(true);

    doc.visibilityState = "visible";
    listeners["document:visibilitychange"]?.();
    observer.emit({
      url: "https://example.test/about",
      path: "/about",
      title: "About",
      navigationType: "push",
      occurredAt: 1760000002000,
    });
    listeners["window:pagehide"]?.();
    callbacks.CLS?.({ name: "CLS", value: 0.01, navigationType: "navigate" });
    await Promise.resolve();
    await analytics.flush();
    expect(sent.at(-1)?.options?.keepalive).toBe(true);

    analytics.destroy();
    vi.unstubAllGlobals();
  });
  it("does not rebind document metrics to a SPA Page View after consent is revoked", () => {
    const bufferSizes: number[] = [];
    const errors: unknown[] = [];
    vi.stubGlobal("window", {
      location: { href: "https://example.test/start", pathname: "/start" },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    vi.stubGlobal("document", {
      title: "Start",
      referrer: "",
      visibilityState: "visible",
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    const analytics = createAnalytics({
      siteId: "site_example",
      consent: "granted",
      onBufferChange: (size) => bufferSizes.push(size),
      onError: (error) => errors.push(error),
      contextProvider: {
        getContext: () => ({
          language: "unknown",
          timezone: "unknown",
          viewport_width: "unknown",
          viewport_height: "unknown",
          screen_width: "unknown",
          screen_height: "unknown",
          user_agent: "unknown",
        }),
      },
    });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);
    observer.emit({
      url: "https://example.test/start",
      path: "/start",
      navigationType: "initial",
      occurredAt: 1760000000000,
    });
    expect(callbacks.LCP).toBeDefined();

    analytics.setConsent("denied");
    analytics.setConsent("granted");
    observer.emit({
      url: "https://example.test/next",
      path: "/next",
      navigationType: "push",
      occurredAt: 1760000001000,
    });
    expect(bufferSizes.at(-1)).toBe(1);

    callbacks.LCP?.({ name: "LCP", value: 1200, navigationType: "navigate" });

    expect(bufferSizes.at(-1)).toBe(1);
    expect(errors).toEqual([]);
    analytics.destroy();
    vi.unstubAllGlobals();
  });

  it("rejects immutable-field changes made by beforeSend toJSON", async () => {
    const errors: unknown[] = [];
    const bufferSizes: number[] = [];
    vi.stubGlobal("window", {
      location: { href: "https://example.test/", pathname: "/" },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    vi.stubGlobal("document", {
      title: "",
      referrer: "",
      visibilityState: "visible",
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    const analytics = createAnalytics({
      siteId: "site_example",
      consent: "granted",
      onError: (error) => errors.push(error),
      onBufferChange: (size) => bufferSizes.push(size),
      beforeSend: (event) => {
        if (event.type !== "web_vital") return event;

        return {
          ...event,
          toJSON() {
            return { ...event, page_view_event_id: "01J00000000000000000000099" };
          },
        };
      },
      contextProvider: {
        getContext: () => ({
          language: "unknown",
          timezone: "unknown",
          viewport_width: "unknown",
          viewport_height: "unknown",
          screen_width: "unknown",
          screen_height: "unknown",
          user_agent: "unknown",
        }),
      },
    });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);
    observer.emit({
      url: "https://example.test/",
      path: "/",
      navigationType: "initial",
      occurredAt: 1760000000000,
    });
    expect(bufferSizes.at(-1)).toBe(1);

    callbacks.LCP?.({ name: "LCP", value: 1, navigationType: "navigate" });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
    expect(bufferSizes.at(-1)).toBe(1);
    analytics.destroy();
    vi.unstubAllGlobals();
  });

  it("drops a report when beforeSend changes the Page View association", async () => {
    const errors: unknown[] = [];
    vi.stubGlobal("window", {
      location: { href: "https://example.test/", pathname: "/" },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    vi.stubGlobal("document", {
      title: "",
      referrer: "",
      visibilityState: "visible",
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    const analytics = createAnalytics({
      siteId: "site_example",
      consent: "granted",
      onError: (error) => errors.push(error),
      beforeSend: (event) =>
        event.type === "web_vital"
          ? { ...event, page_view_event_id: "01J00000000000000000000099" }
          : event,
      contextProvider: {
        getContext: () => ({
          language: "unknown",
          timezone: "unknown",
          viewport_width: "unknown",
          viewport_height: "unknown",
          screen_width: "unknown",
          screen_height: "unknown",
          user_agent: "unknown",
        }),
      },
    });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);
    observer.emit({
      url: "https://example.test/",
      path: "/",
      navigationType: "initial",
      occurredAt: 1760000000000,
    });
    callbacks.LCP?.({ name: "LCP", value: 1, navigationType: "navigate" });
    expect(errors[0]).toBeInstanceOf(TypeError);
    analytics.destroy();
    vi.unstubAllGlobals();
  });
});
