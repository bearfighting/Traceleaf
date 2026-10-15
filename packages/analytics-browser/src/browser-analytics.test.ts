import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { observerSubscribe, createObserver } = vi.hoisted(() => ({
  observerSubscribe: vi.fn((listener: unknown) => {
    void listener;

    return () => {};
  }),
  createObserver: vi.fn(),
}));

vi.mock("@web-analytics/observer-core", () => ({
  createNavigationApiObserver: createObserver,
}));

import { createBrowserAnalytics, type BrowserAnalyticsOptions } from "./browser-analytics";

import type { Transport } from "@web-analytics/analytics-core";
import type { NavigationEvent } from "@web-analytics/observer-core";
import type { AnalyticsEvent, BrowserContextV1 } from "@web-analytics/protocol-ts";

const validCustomTransport: Transport = { async sendBatch() {} };

beforeEach(() => {
  createObserver.mockClear();
  observerSubscribe.mockClear();
  createObserver.mockReturnValue({ subscribe: observerSubscribe });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createBrowserAnalytics consent", () => {
  it("records the current page when consent is granted after the initial notification", async () => {
    const currentLocation = {
      href: "https://example.test/first",
      pathname: "/first",
    };
    vi.stubGlobal("window", { location: currentLocation });
    vi.stubGlobal("document", { title: "Current page", referrer: "" });
    const sendBatch = vi.fn(async (events: readonly AnalyticsEvent[]) => {
      void events;
    });
    const context: BrowserContextV1 = {
      language: "en-CA",
      timezone: "UTC",
      viewport_width: 1280,
      viewport_height: 720,
      screen_width: 1280,
      screen_height: 720,
      user_agent: "test",
    };
    const analytics = createBrowserAnalytics({
      siteId: "site_consent_lifecycle",
      transport: { sendBatch },
      contextProvider: { getContext: () => context },
      visitorIdStore: { read: () => null, write: () => true, remove() {} },
    });
    const observerListener = observerSubscribe.mock.calls[0]?.[0] as
      ((event: NavigationEvent) => void) | undefined;

    observerListener?.({
      url: currentLocation.href,
      path: currentLocation.pathname,
      navigationType: "initial",
      occurredAt: 100,
    });
    currentLocation.href = "https://example.test/current";
    currentLocation.pathname = "/current";
    analytics.setConsent("granted");
    await analytics.flush();

    expect(sendBatch).toHaveBeenCalledOnce();
    expect(sendBatch.mock.calls[0]?.[0]).toMatchObject([
      { type: "page_view", path: "/current", title: "Current page" },
    ]);
    analytics.destroy();
  });
});

describe("createBrowserAnalytics configuration", () => {
  it("accepts a custom transport", () => {
    const analytics = createBrowserAnalytics({
      siteId: "site_example",
      transport: validCustomTransport,
    });

    expect(createObserver).toHaveBeenCalledOnce();
    analytics.destroy();
  });

  it("accepts Fetch transport configuration", () => {
    const analytics = createBrowserAnalytics({
      siteId: "site_example",
      endpoint: "https://collector.example/v1/events",
      ingestKey: "public-key",
    });

    expect(createObserver).toHaveBeenCalledOnce();
    analytics.destroy();
  });

  it.each([
    ["missing transport configuration", { siteId: "site_example" }],
    [
      "partial Fetch configuration",
      { siteId: "site_example", endpoint: "https://collector.example/v1/events" },
    ],
    [
      "conflicting transport configuration",
      {
        siteId: "site_example",
        transport: validCustomTransport,
        endpoint: "https://collector.example/v1/events",
        ingestKey: "key",
      },
    ],
    ["invalid site ID", { siteId: "invalid site", transport: validCustomTransport }],
    [
      "invalid endpoint",
      { siteId: "site_example", endpoint: "https://collector.example/events", ingestKey: "key" },
    ],
    [
      "empty ingest key",
      { siteId: "site_example", endpoint: "https://collector.example/v1/events", ingestKey: "" },
    ],
    ["invalid custom transport", { siteId: "site_example", transport: {} }],
  ])("disables analytics for %s", async (_description, config) => {
    createObserver.mockClear();
    observerSubscribe.mockClear();
    const onError = vi.fn();
    const read = vi.fn(() => null);
    const write = vi.fn(() => true);
    const remove = vi.fn();
    const onBufferChange = vi.fn();
    const analytics = createBrowserAnalytics({
      ...config,
      consent: "granted",
      visitorIdStore: { read, write, remove },
      onBufferChange,
      onError,
    } as unknown as BrowserAnalyticsOptions);

    analytics.observe({ subscribe: observerSubscribe });
    analytics.pageview();
    analytics.event("test");
    analytics.setConsent("denied");
    analytics.setConsent("granted");
    await expect(analytics.flush()).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledOnce();
    expect(createObserver).not.toHaveBeenCalled();
    expect(observerSubscribe).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(onBufferChange).not.toHaveBeenCalled();
    expect(analytics.getConsent()).toBe("granted");
    analytics.destroy();
  });

  it("silently disables analytics when no error callback is configured", () => {
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const analytics = createBrowserAnalytics({
      siteId: "site_example",
      transport: validCustomTransport,
      endpoint: "https://collector.example/v1/events",
      ingestKey: "key",
    } as unknown as BrowserAnalyticsOptions);

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    analytics.destroy();
    warn.mockRestore();
    error.mockRestore();
  });

  it("isolates an error callback that throws", async () => {
    expect(() =>
      createBrowserAnalytics({
        siteId: "site_example",
        onError() {
          throw new Error("diagnostic failed");
        },
      } as unknown as BrowserAnalyticsOptions),
    ).not.toThrow();
  });
});
