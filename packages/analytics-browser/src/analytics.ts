import {
  createCustomEvent,
  createPageViewEvent,
  processPageViewEvent,
  type BeforeSend,
  type Transport,
} from "@web-analytics/analytics-core";
import {
  isWebVitalEvent,
  validateCustomEventProperties,
  webVitalRating,
  WEB_VITAL_METRICS,
} from "@web-analytics/protocol-ts";
import { ulid } from "ulid";
import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";

import { createBrowserContextProvider, type BrowserContextProvider } from "./browser-context";
import { getCurrentNavigation } from "./navigation";
import {
  createVisitorId,
  createVisitorIdStore,
  isCanonicalVisitorId,
  type VisitorIdStore,
} from "./visitor-id";

import type { NavigationEvent, NavigationObserver } from "@web-analytics/observer-core";
import type { AnalyticsEvent } from "@web-analytics/protocol-ts";

export type AnalyticsConsent = "denied" | "granted";

export interface AnalyticsOptions {
  siteId: string;
  consent?: AnalyticsConsent;
  transport?: Transport;
  beforeSend?: BeforeSend;
  contextProvider?: BrowserContextProvider;
  createEventId?: () => string;
  now?: () => number;
  onError?: (error: unknown) => void;
  onBufferChange?: (bufferSize: number) => void;
  bufferSize?: number;
  flushIntervalMs?: number;
  visitorIdStore?: VisitorIdStore;
}

export interface Analytics {
  observe(observer: NavigationObserver): () => void;
  pageview(): void;
  event(
    name: string,
    properties?: Record<string, import("@web-analytics/protocol-ts").CustomEventProperty>,
  ): void;
  flush(): Promise<void>;
  destroy(): void;
  setConsent(consent: AnalyticsConsent): void;
  getConsent(): AnalyticsConsent;
}

const noOpTransport: Transport = {
  async sendBatch() {},
};

export function createAnalytics(options: AnalyticsOptions): Analytics {
  const transport = options.transport ?? noOpTransport;
  const contextProvider = options.contextProvider ?? createBrowserContextProvider();
  const now = options.now ?? Date.now;
  const subscriptions = new Set<() => void>();
  const pendingSends = new Set<Promise<void>>();
  const buffer: AnalyticsEvent[] = [];
  const settledErrors: unknown[] = [];
  const bufferSize = normalizePositiveInteger(options.bufferSize, 20);
  const flushIntervalMs = normalizePositiveInteger(options.flushIntervalMs, 5000);
  let flushTimer: ReturnType<typeof setInterval> | undefined;
  let destroyed = false;
  let vitalListenersStarted = false;
  let vitalCollectionDisabled = false;
  let vitalReportSequence = 0;
  let pageIsHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  let vitalPageView: { eventId: string; path: string; occurredAt: number } | undefined;
  let consent: AnalyticsConsent = options.consent ?? "denied";
  const visitorIdStore = options.visitorIdStore ?? createVisitorIdStore(options.siteId);

  const notifyBufferChange = () => {
    try {
      options.onBufferChange?.(buffer.length);
    } catch {
      // Observability callbacks must not interrupt event processing.
    }
  };

  const reportError = (error: unknown) => {
    settledErrors.push(error);
    try {
      options.onError?.(error);
    } catch {
      // Error reporting must not replace the original SDK error.
    }
  };

  const trackSend = (promise: Promise<void>) => {
    const tracked = promise.catch((error: unknown) => {
      reportError(error);

      throw error;
    });
    pendingSends.add(tracked);
    void tracked.then(
      () => pendingSends.delete(tracked),
      () => pendingSends.delete(tracked),
    );
  };

  const sendBatch = (events: AnalyticsEvent[], keepalive = false) => {
    const refreshed = events.map((event) => {
      if (event.type === "web_vital") return event;
      const visitorId = visitorIdStore.read();
      if (visitorId && isCanonicalVisitorId(visitorId)) return { ...event, visitor_id: visitorId };
      const withoutVisitorId = { ...event };

      delete withoutVisitorId.visitor_id;

      return withoutVisitorId;
    });
    try {
      trackSend(Promise.resolve(transport.sendBatch(refreshed, { keepalive })));
    } catch (error) {
      reportError(error);
    }
  };

  const flushBuffer = (keepalive = false) => {
    if (buffer.length === 0) {
      return;
    }

    const events = buffer.splice(0, buffer.length);
    notifyBufferChange();
    sendBatch(events, keepalive);
  };

  const ensureFlushTimer = () => {
    if (flushTimer || typeof window === "undefined") {
      return;
    }

    flushTimer = setInterval(flushBuffer, flushIntervalMs);
  };

  const enqueue = (event: AnalyticsEvent) => {
    buffer.push(event);
    notifyBufferChange();

    if (buffer.length >= bufferSize) {
      void flushBuffer(pageIsHidden);
    }
  };

  const handleNavigation = (navigation: NavigationEvent, occurredAt?: number) => {
    if (destroyed || consent !== "granted") {
      return;
    }

    try {
      const visitorId = createVisitorId(visitorIdStore);
      const event = createPageViewEvent(navigation, {
        siteId: options.siteId,
        visitorId: visitorId ?? undefined,
        context: normalizeContext(contextProvider.getContext()),
        createEventId: options.createEventId,
        now: occurredAt === undefined ? options.now : () => occurredAt,
      });
      const processed = processPageViewEvent(event, options.beforeSend);

      if (processed === null) {
        return;
      }

      if (
        processed.schema_version !== event.schema_version ||
        processed.type !== "page_view" ||
        processed.event_id !== event.event_id ||
        processed.site_id !== event.site_id
      ) {
        throw new TypeError("beforeSend must preserve schema_version, type, event_id, and site_id");
      }

      enqueue(processed);
      if (
        !vitalCollectionDisabled &&
        !vitalListenersStarted &&
        typeof window !== "undefined" &&
        typeof document !== "undefined"
      ) {
        vitalPageView = {
          eventId: processed.event_id,
          path: processed.path,
          occurredAt: processed.occurred_at,
        };
        startWebVitals();
      }
    } catch (error) {
      reportError(error);
    }
  };

  const visibilityFlush = () => {
    pageIsHidden = document.visibilityState === "hidden";
    if (pageIsHidden) queueMicrotask(() => flushBuffer(true));
  };
  const pageHideFlush = () => {
    pageIsHidden = true;
    queueMicrotask(() => flushBuffer(true));
  };
  const reportVital = (metric: import("web-vitals").Metric) => {
    const page = vitalPageView;
    if (!page || consent !== "granted" || vitalCollectionDisabled || destroyed) return;
    if (
      !WEB_VITAL_METRICS.includes(
        metric.name as import("@web-analytics/protocol-ts").WebVitalMetric,
      )
    ) {
      reportError(new TypeError("Unsupported Web Vital metric."));

      return;
    }
    const name = metric.name as import("@web-analytics/protocol-ts").WebVitalMetric;
    const rating = webVitalRating(name, metric.value);
    if (!rating) {
      reportError(new TypeError("Web Vital value is outside the protocol range."));

      return;
    }
    const navigationType =
      metric.navigationType === "back-forward" || metric.navigationType === "back-forward-cache"
        ? "back_forward"
        : metric.navigationType === "reload" || metric.navigationType === "prerender"
          ? metric.navigationType
          : "navigate";
    let event: import("@web-analytics/protocol-ts").WebVitalEvent = {
      schema_version: 1,
      event_id: options.createEventId?.() ?? ulid(),
      type: "web_vital",
      site_id: options.siteId,
      occurred_at: now(),
      page_view_event_id: page.eventId,
      path: page.path,
      page_view_occurred_at: page.occurredAt,
      metric: name,
      value: metric.value,
      rating,
      navigation_type: navigationType,
      report_sequence: ++vitalReportSequence,
    };
    try {
      const immutable = {
        schema_version: event.schema_version,
        type: event.type,
        event_id: event.event_id,
        site_id: event.site_id,
        page_view_event_id: event.page_view_event_id,
        path: event.path,
        page_view_occurred_at: event.page_view_occurred_at,
        report_sequence: event.report_sequence,
      };
      const processed = options.beforeSend ? options.beforeSend(event) : event;
      if (processed === null) return;
      if (
        Object.entries(immutable).some(
          ([key, value]) => (processed as unknown as Record<string, unknown>)[key] !== value,
        )
      )
        throw new TypeError(
          "beforeSend must preserve Web Vital identity and Page View association fields",
        );
      const serialized = JSON.stringify(processed);
      if (!serialized)
        throw new TypeError("beforeSend must return a JSON-compatible Web Vital event");
      event = JSON.parse(serialized) as typeof event;
      if (
        Object.entries(immutable).some(
          ([key, value]) => (event as unknown as Record<string, unknown>)[key] !== value,
        )
      )
        throw new TypeError(
          "beforeSend must preserve Web Vital identity and Page View association fields",
        );
      const fields = [
        "schema_version",
        "event_id",
        "type",
        "site_id",
        "occurred_at",
        "page_view_event_id",
        "path",
        "page_view_occurred_at",
        "metric",
        "value",
        "rating",
        "navigation_type",
        "report_sequence",
      ];
      if (Object.keys(event).some((key) => !fields.includes(key)) || !isWebVitalEvent(event))
        throw new TypeError("Invalid Web Vital event returned by beforeSend.");
      enqueue(event);
    } catch (error) {
      reportError(error);
    }
  };
  const startWebVitals = () => {
    if (
      vitalListenersStarted ||
      typeof window === "undefined" ||
      typeof document === "undefined" ||
      typeof window.addEventListener !== "function" ||
      typeof document.addEventListener !== "function"
    )
      return;
    vitalListenersStarted = true;
    document.addEventListener("visibilitychange", visibilityFlush);
    window.addEventListener("pagehide", pageHideFlush);
    onLCP(reportVital);
    onINP(reportVital);
    onCLS(reportVital);
    onFCP(reportVital);
    onTTFB(reportVital);
  };

  return {
    observe(observer) {
      if (destroyed) {
        return () => {};
      }

      ensureFlushTimer();
      let active = true;
      const unsubscribeObserver = observer.subscribe(handleNavigation);
      const unsubscribe = () => {
        if (!active) {
          return;
        }
        active = false;
        subscriptions.delete(unsubscribe);
        unsubscribeObserver();
      };
      subscriptions.add(unsubscribe);

      return unsubscribe;
    },

    pageview() {
      if (destroyed || consent !== "granted") {
        return;
      }
      ensureFlushTimer();
      const navigation = getCurrentNavigation(now);
      if (navigation) {
        handleNavigation(navigation, navigation.occurredAt);
      }
    },

    event(name, properties = {}) {
      if (destroyed || consent !== "granted") return;
      ensureFlushTimer();
      try {
        const visitorId = visitorIdStore.read();
        const event = createCustomEvent({
          siteId: options.siteId,
          name,
          properties,
          visitorId: visitorId && isCanonicalVisitorId(visitorId) ? visitorId : undefined,
          createEventId: options.createEventId,
          now,
        });
        const immutableFields = {
          schema_version: event.schema_version,
          type: event.type,
          event_id: event.event_id,
          site_id: event.site_id,
        };
        const processed = options.beforeSend ? options.beforeSend(event) : event;
        if (processed === null) return;
        if (
          processed.schema_version !== immutableFields.schema_version ||
          processed.type !== immutableFields.type ||
          processed.event_id !== immutableFields.event_id ||
          processed.site_id !== immutableFields.site_id
        ) {
          throw new TypeError(
            "beforeSend must preserve schema_version, type, event_id, and site_id",
          );
        }
        if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(processed.event_name)) {
          throw new TypeError("Custom event name must match the protocol format.");
        }
        const propertiesError = validateCustomEventProperties(processed.properties);
        if (propertiesError) throw new TypeError(propertiesError);

        // Queue a validated snapshot because a hook can retain or mutate its result.
        const serialized = JSON.stringify(processed);
        if (serialized === undefined) {
          throw new TypeError("beforeSend must return a JSON-compatible Custom Event.");
        }
        const snapshot = JSON.parse(serialized) as typeof processed;
        const snapshotPropertiesError = validateCustomEventProperties(snapshot.properties);
        if (snapshotPropertiesError) throw new TypeError(snapshotPropertiesError);
        enqueue(snapshot);
      } catch (error) {
        reportError(error);
      }
    },

    setConsent(nextConsent) {
      if (destroyed || consent === nextConsent) return;
      consent = nextConsent;
      if (consent === "denied") {
        buffer.splice(0, buffer.length);
        if (vitalListenersStarted) vitalCollectionDisabled = true;
        vitalPageView = undefined;
        notifyBufferChange();
        visitorIdStore.remove();
      } else {
        ensureFlushTimer();
      }
    },

    getConsent() {
      return consent;
    },

    async flush() {
      flushBuffer();
      const sends = [...pendingSends];
      await Promise.allSettled(sends);

      if (settledErrors.length > 0) {
        throw settledErrors.shift();
      }
    },

    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      if (
        typeof window !== "undefined" &&
        typeof document !== "undefined" &&
        typeof document.removeEventListener === "function"
      )
        document.removeEventListener("visibilitychange", visibilityFlush);
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function")
        window.removeEventListener("pagehide", pageHideFlush);
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = undefined;
      }
      buffer.splice(0, buffer.length);
      notifyBufferChange();
      for (const unsubscribe of [...subscriptions]) {
        unsubscribe();
      }
    },
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeContext(
  value: import("@web-analytics/protocol-ts").BrowserContextV1,
): import("@web-analytics/protocol-ts").BrowserContextV1 {
  const source = value as unknown as Record<string, unknown>;
  const dimension = (candidate: unknown) =>
    typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : ("unknown" as const);
  const text = (candidate: unknown, maxLength: number) =>
    typeof candidate === "string" && candidate.length > 0 && candidate.length <= maxLength
      ? candidate
      : "unknown";
  const context: import("@web-analytics/protocol-ts").BrowserContextV1 = {
    language: text(source.language, 64),
    timezone: text(source.timezone, 64),
    viewport_width: dimension(source.viewport_width),
    viewport_height: dimension(source.viewport_height),
    screen_width: dimension(source.screen_width),
    screen_height: dimension(source.screen_height),
    user_agent: text(source.user_agent, 1024),
  };
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "referrer",
  ] as const) {
    const candidate = source[key];
    const maxLength = key === "referrer" ? 4096 : 256;
    if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= maxLength) {
      context[key] = candidate;
    }
  }

  return context;
}
