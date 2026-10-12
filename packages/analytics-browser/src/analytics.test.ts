import { MemoryNavigationObserver } from "@web-analytics/observer-core";
import { describe, expect, it, vi } from "vitest";

import { createAnalytics as createAnalyticsImpl, type AnalyticsOptions } from "./analytics";

import type { Transport } from "@web-analytics/analytics-core";
import type { AnalyticsEvent } from "@web-analytics/protocol-ts";

class MockTransport implements Transport {
  batches: AnalyticsEvent[][] = [];

  async sendBatch(events: Parameters<Transport["sendBatch"]>[0]) {
    this.batches.push([...events]);
  }
}

const navigation = {
  url: "https://example.test/about?source=x",
  path: "/about",
  title: "About",
  referrer: "https://example.test/",
  navigationType: "push" as const,
  occurredAt: 100,
};

const createAnalytics = (options: AnalyticsOptions) =>
  createAnalyticsImpl({ consent: "granted", ...options });

const unknownContextProvider = {
  getContext: () => ({
    language: "unknown",
    timezone: "unknown",
    viewport_width: "unknown" as const,
    viewport_height: "unknown" as const,
    screen_width: "unknown" as const,
    screen_height: "unknown" as const,
    user_agent: "unknown",
  }),
};

describe("createAnalytics", () => {
  it("defaults to denied and ignores page views", async () => {
    const transport = new MockTransport();
    const analytics = createAnalyticsImpl({ siteId: "site_example", transport });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);
    observer.emit(navigation);
    analytics.pageview();
    await analytics.flush();
    expect(transport.batches).toHaveLength(0);
  });

  it("revoking consent clears pending events and removes the visitor id", async () => {
    const transport = new MockTransport();
    const store = {
      value: "550e8400-e29b-41d4-a716-446655440000" as string | null,
      read() {
        return this.value;
      },
      write(value: string) {
        this.value = value;

        return true;
      },
      remove() {
        this.value = null;
      },
    };
    const analytics = createAnalyticsImpl({
      siteId: "site_example",
      consent: "granted",
      transport,
      visitorIdStore: store,
      contextProvider: {
        getContext: () => ({
          language: "en-CA",
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
    observer.emit(navigation);
    analytics.setConsent("denied");
    await analytics.flush();
    expect(store.value).toBeNull();
    expect(transport.batches).toHaveLength(0);
  });

  it("creates a manual page view from the browser location", async () => {
    vi.stubGlobal("window", {
      location: { href: "https://example.test/manual?utm_source=test", pathname: "/manual" },
    });
    vi.stubGlobal("document", {
      title: "Manual page",
      referrer: "https://referrer.test/",
    });
    const transport = new MockTransport();
    const clock = vi.fn(() => 202);
    const analytics = createAnalytics({
      siteId: "site_example",
      transport,
      createEventId: () => "01J00000000000000000000002",
      now: clock,
      contextProvider: unknownContextProvider,
    });

    analytics.pageview();
    await analytics.flush();
    vi.unstubAllGlobals();

    expect(transport.batches[0]?.[0]).toMatchObject({
      url: "https://example.test/manual?utm_source=test",
      path: "/manual",
      title: "Manual page",
      referrer: "https://referrer.test/",
      occurred_at: 202,
    });
    expect(clock).toHaveBeenCalledOnce();
  });

  it("converts observed navigation and merges context", async () => {
    const transport = new MockTransport();
    const analytics = createAnalytics({
      siteId: "site_example",
      transport,
      createEventId: () => "01J00000000000000000000000",
      now: () => 200,
      contextProvider: {
        getContext: () => ({
          ...unknownContextProvider.getContext(),
          language: "en-CA",
        }),
      },
    });
    const observer = new MemoryNavigationObserver();

    analytics.observe(observer);
    observer.emit(navigation);
    await analytics.flush();

    expect(transport.batches).toEqual([
      [
        {
          schema_version: 1,
          event_id: "01J00000000000000000000000",
          type: "page_view",
          site_id: "site_example",
          occurred_at: 200,
          url: navigation.url,
          path: navigation.path,
          title: navigation.title,
          referrer: navigation.referrer,
          context_schema_version: 1,
          context: {
            language: "en-CA",
            timezone: "unknown",
            viewport_width: "unknown",
            viewport_height: "unknown",
            screen_width: "unknown",
            screen_height: "unknown",
            user_agent: "unknown",
          },
        },
      ],
    ]);
  });

  it("maps invalid and oversized context values to unknown or omission", async () => {
    const transport = new MockTransport();
    const analytics = createAnalytics({
      siteId: "site_example",
      transport,
      contextProvider: {
        getContext: () => ({
          language: "x".repeat(65),
          timezone: "unknown",
          viewport_width: -1,
          viewport_height: "unknown" as const,
          screen_width: "unknown" as const,
          screen_height: "unknown" as const,
          user_agent: "x".repeat(1025),
          utm_source: "x".repeat(257),
          referrer: "x".repeat(4097),
        }),
      },
    });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);
    observer.emit(navigation);
    await analytics.flush();

    expect(transport.batches[0]?.[0]).toMatchObject({
      context: {
        language: "unknown",
        viewport_width: "unknown",
        user_agent: "unknown",
      },
    });
    expect(transport.batches[0]?.[0]).not.toHaveProperty("context.utm_source");
    expect(transport.batches[0]?.[0]).not.toHaveProperty("context.referrer");
  });

  it("supports beforeSend modification and dropping", async () => {
    const transport = new MockTransport();
    const analytics = createAnalytics({
      siteId: "site_example",
      transport,
      beforeSend: (event) => (event.type === "page_view" ? { ...event, title: "Changed" } : event),
      createEventId: () => "01J00000000000000000000001",
      now: () => 201,
      contextProvider: unknownContextProvider,
    });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);
    observer.emit(navigation);
    await analytics.flush();
    expect(transport.batches[0]?.[0]).toMatchObject({ type: "page_view", title: "Changed" });

    const dropped = createAnalytics({
      siteId: "site_example",
      transport,
      beforeSend: () => null,
      contextProvider: unknownContextProvider,
    });
    const droppedObserver = new MemoryNavigationObserver();
    dropped.observe(droppedObserver);
    droppedObserver.emit(navigation);
    await dropped.flush();
    expect(transport.batches).toHaveLength(1);
  });

  it("reports errors and rejects flush", async () => {
    const error = new Error("transport failed");
    const onError = vi.fn();
    const transport: Transport = { sendBatch: vi.fn(async () => Promise.reject(error)) };
    const analytics = createAnalytics({ siteId: "site_example", transport, onError });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);
    observer.emit(navigation);

    await expect(analytics.flush()).rejects.toThrow("transport failed");
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("waits for in-flight sends", async () => {
    let resolveSend!: () => void;
    const sendPromise = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    const transport: Transport = { sendBatch: vi.fn(() => sendPromise) };
    const analytics = createAnalytics({ siteId: "site_example", transport });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);
    observer.emit(navigation);

    let flushed = false;
    const flushPromise = analytics.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    resolveSend();
    await flushPromise;
    expect(flushed).toBe(true);
  });

  it("does not include sends created after flushing starts", async () => {
    const resolvers: Array<() => void> = [];
    const transport: Transport = {
      sendBatch: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    };
    const analytics = createAnalytics({ siteId: "site_example", transport });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);
    observer.emit(navigation);

    let flushed = false;
    const flushPromise = analytics.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();

    observer.emit({ ...navigation, path: "/next" });
    resolvers[0]?.();
    await flushPromise;
    expect(flushed).toBe(true);

    const secondFlush = analytics.flush();
    resolvers[1]?.();
    await secondFlush;
  });

  it("flushes non-empty buffers on the interval and skips empty buffers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {});
    const transport = new MockTransport();
    const analytics = createAnalytics({
      siteId: "site_example",
      transport,
      flushIntervalMs: 5000,
      contextProvider: unknownContextProvider,
    });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);

    vi.advanceTimersByTime(5000);
    expect(transport.batches).toHaveLength(0);

    observer.emit(navigation);
    vi.advanceTimersByTime(4999);
    expect(transport.batches).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(transport.batches).toHaveLength(1);
    await analytics.flush();
    analytics.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("flushes automatically when the buffer reaches its limit", async () => {
    const transport = new MockTransport();
    const analytics = createAnalytics({
      siteId: "site_example",
      transport,
      bufferSize: 2,
      contextProvider: unknownContextProvider,
    });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);

    observer.emit(navigation);
    expect(transport.batches).toHaveLength(0);
    observer.emit({ ...navigation, path: "/next" });
    await analytics.flush();

    expect(transport.batches).toHaveLength(1);
    expect(transport.batches[0]).toHaveLength(2);
  });

  it("isolates buffers and transports between analytics instances", async () => {
    const firstTransport = new MockTransport();
    const secondTransport = new MockTransport();
    const firstAnalytics = createAnalytics({
      siteId: "site_first",
      transport: firstTransport,
      contextProvider: unknownContextProvider,
    });
    const secondAnalytics = createAnalytics({
      siteId: "site_second",
      transport: secondTransport,
      contextProvider: unknownContextProvider,
    });
    const firstObserver = new MemoryNavigationObserver();
    const secondObserver = new MemoryNavigationObserver();

    firstAnalytics.observe(firstObserver);
    secondAnalytics.observe(secondObserver);
    firstObserver.emit(navigation);

    await firstAnalytics.flush();
    await secondAnalytics.flush();

    expect(firstTransport.batches).toHaveLength(1);
    expect(secondTransport.batches).toHaveLength(0);
    expect(firstTransport.batches[0]?.[0].site_id).toBe("site_first");

    firstAnalytics.destroy();
    secondAnalytics.destroy();
  });

  it("reports buffer changes and clears the timer and buffer on destroy", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {});
    const transport = new MockTransport();
    const onBufferChange = vi.fn();
    const analytics = createAnalytics({
      siteId: "site_example",
      transport,
      onBufferChange,
      contextProvider: unknownContextProvider,
    });
    const observer = new MemoryNavigationObserver();

    analytics.observe(observer);
    observer.emit(navigation);
    analytics.destroy();
    vi.advanceTimersByTime(5000);
    await analytics.flush();

    expect(onBufferChange.mock.calls.map(([size]) => size)).toEqual([1, 0]);
    expect(transport.batches).toHaveLength(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not retry a failed batch on later timer ticks", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {});
    const error = new Error("transport failed");
    const transport: Transport = {
      sendBatch: vi.fn(async () => Promise.reject(error)),
    };
    const analytics = createAnalytics({
      siteId: "site_example",
      transport,
      contextProvider: unknownContextProvider,
    });
    const observer = new MemoryNavigationObserver();

    analytics.observe(observer);
    observer.emit(navigation);
    await expect(analytics.flush()).rejects.toThrow("transport failed");
    vi.advanceTimersByTime(10000);

    expect(transport.sendBatch).toHaveBeenCalledOnce();
    analytics.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports transport failures through onError without writing to the console", async () => {
    const error = new Error("transport failed");
    const onError = vi.fn();
    const warn = vi.spyOn(console, "warn");
    const consoleError = vi.spyOn(console, "error");
    const transport: Transport = {
      sendBatch: vi.fn(async () => Promise.reject(error)),
    };
    const analytics = createAnalytics({
      siteId: "site_example",
      transport,
      onError,
      contextProvider: unknownContextProvider,
    });
    const observer = new MemoryNavigationObserver();

    analytics.observe(observer);
    observer.emit(navigation);

    await expect(analytics.flush()).rejects.toBe(error);
    expect(onError).toHaveBeenCalledWith(error);
    expect(warn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    analytics.destroy();
    warn.mockRestore();
    consoleError.mockRestore();
  });

  it("reports beforeSend errors through onError and flush", async () => {
    const error = new Error("beforeSend failed");
    const onError = vi.fn();
    const transport = new MockTransport();
    const analytics = createAnalytics({
      siteId: "site_example",
      transport,
      beforeSend: () => {
        throw error;
      },
      onError,
    });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);
    observer.emit(navigation);

    await expect(analytics.flush()).rejects.toThrow("beforeSend failed");
    expect(onError).toHaveBeenCalledWith(error);
    expect(transport.batches).toHaveLength(0);
  });

  it("preserves the original error when onError throws", async () => {
    const error = new Error("original failure");
    const analytics = createAnalytics({
      siteId: "site_example",
      beforeSend: () => {
        throw error;
      },
      onError: () => {
        throw new Error("error handler failure");
      },
    });
    const observer = new MemoryNavigationObserver();
    analytics.observe(observer);
    observer.emit(navigation);

    await expect(analytics.flush()).rejects.toThrow("original failure");
  });

  it("is safe in Node and stops after destroy", async () => {
    const transport = new MockTransport();
    const analytics = createAnalytics({ siteId: "site_example", transport });
    const observer = new MemoryNavigationObserver();
    const unsubscribe = analytics.observe(observer);
    unsubscribe();
    unsubscribe();
    observer.emit(navigation);
    analytics.pageview();
    analytics.destroy();
    await analytics.flush();
    expect(transport.batches).toHaveLength(0);
  });
});
