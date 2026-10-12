import { createNavigationApiObserver } from "@web-analytics/observer-core";
import { FetchTransport } from "@web-analytics/transport";

import { createAnalytics } from "./analytics";
import { getCurrentNavigation } from "./navigation";

import type { Analytics, AnalyticsOptions } from "./analytics";
import type { Transport } from "@web-analytics/analytics-core";
import type { NavigationEvent, NavigationObserver } from "@web-analytics/observer-core";

const observedInitialPageViews = new WeakMap<Document, Set<string>>();

type BrowserTransportOptions =
  | { transport: Transport; endpoint?: never; ingestKey?: never }
  | { transport?: never; endpoint: string; ingestKey: string };

export type BrowserAnalyticsOptions = Omit<AnalyticsOptions, "transport"> &
  BrowserTransportOptions & {
    onNavigation?: (event: NavigationEvent) => void;
  };

const SITE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function shouldForwardNavigation(
  event: NavigationEvent,
  siteId: string,
  consentGranted: boolean,
): boolean {
  if (event.navigationType !== "initial" || typeof document === "undefined" || !consentGranted) {
    return true;
  }

  let siteIds = observedInitialPageViews.get(document);
  if (!siteIds) {
    siteIds = new Set();
    observedInitialPageViews.set(document, siteIds);
  }
  if (siteIds.has(siteId)) return false;

  siteIds.add(siteId);

  return true;
}

/** Creates Analytics with the browser Navigation API observer already connected. */
export function createBrowserAnalytics(options: BrowserAnalyticsOptions): Analytics {
  const { onNavigation, ...analyticsOptions } = options;
  const configError = validateBrowserAnalyticsOptions(options);
  if (configError) {
    try {
      options.onError?.(configError);
    } catch {
      // Configuration reporting must not interrupt the host application.
    }

    return createDisabledAnalytics(options.consent ?? "denied");
  }

  const transport =
    options.transport ??
    new FetchTransport({
      endpoint: options.endpoint!,
      ingestKey: options.ingestKey!,
    });
  const analytics = createAnalytics({ ...analyticsOptions, transport });
  const observer = createNavigationApiObserver();
  let initialNavigationObserved = false;
  let dispatchNavigation: ((event: NavigationEvent) => void) | undefined;
  const browserObserver: NavigationObserver = {
    subscribe(listener) {
      dispatchNavigation = (event) => {
        if (analytics.getConsent() !== "granted") return;
        if (!shouldForwardNavigation(event, analyticsOptions.siteId, true)) return;

        listener(event);
        try {
          onNavigation?.(event);
        } catch {
          // Playground and diagnostic callbacks must not interrupt analytics collection.
        }
      };

      return observer.subscribe((event) => {
        if (event.navigationType === "initial") initialNavigationObserved = true;
        dispatchNavigation?.(event);
      });
    },
  };
  const unsubscribeAnalytics = analytics.observe(browserObserver);

  return {
    ...analytics,
    setConsent(consent) {
      const wasGranted = analytics.getConsent() === "granted";
      analytics.setConsent(consent);
      if (wasGranted || consent !== "granted" || !initialNavigationObserved) return;

      const currentNavigation = getCurrentNavigation();
      if (currentNavigation) {
        dispatchNavigation?.({ ...currentNavigation, navigationType: "initial" });
      }
    },
    destroy() {
      unsubscribeAnalytics();
      analytics.destroy();
    },
  };
}

function validateBrowserAnalyticsOptions(options: BrowserAnalyticsOptions): Error | undefined {
  if (typeof options.siteId !== "string" || !SITE_ID_PATTERN.test(options.siteId)) {
    return new TypeError("BrowserAnalytics siteId must match the Protocol format.");
  }

  const hasTransport = options.transport !== undefined;
  const hasEndpoint = options.endpoint !== undefined;
  const hasIngestKey = options.ingestKey !== undefined;
  if (hasTransport === (hasEndpoint || hasIngestKey)) {
    return new TypeError("Provide either transport or both endpoint and ingestKey.");
  }
  if (hasEndpoint !== hasIngestKey) {
    return new TypeError("BrowserAnalytics endpoint and ingestKey must be provided together.");
  }
  if (hasTransport && typeof options.transport?.sendBatch !== "function") {
    return new TypeError("BrowserAnalytics transport must provide sendBatch().");
  }
  if (hasEndpoint) {
    try {
      new FetchTransport({ endpoint: options.endpoint!, ingestKey: options.ingestKey! });
    } catch (error) {
      return error instanceof Error ? error : new TypeError(String(error));
    }
  }

  return undefined;
}

function createDisabledAnalytics(consent: AnalyticsOptions["consent"]): Analytics {
  const currentConsent = consent ?? "denied";

  return {
    observe: () => () => {},
    pageview() {},
    event() {},
    async flush() {},
    destroy() {},
    setConsent() {},
    getConsent: () => currentConsent,
  };
}
