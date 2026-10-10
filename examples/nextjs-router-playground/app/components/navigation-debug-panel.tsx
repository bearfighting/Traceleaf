"use client";

import { createBrowserAnalytics, type AnalyticsConsent } from "@traceleaf/browser";
import { createPlaygroundTransport } from "@web-analytics/playground-support";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Transport } from "@web-analytics/analytics-core";
import type { NavigationEvent } from "@web-analytics/observer-core";
import type { AnalyticsEvent } from "@web-analytics/protocol-ts";

type NavigationLogEntry = NavigationEvent & {
  timestamp: string;
  previousUrl: string | null;
};

const MAX_LOG_ENTRIES = 20;

interface WorkflowState {
  bufferedEvents: number;
  sentBatches: number;
  sentEvents: number;
  sentPageViews: number;
  lastBatchSize: number | null;
  lastSentAt: string | null;
  lastError: string | null;
}

const initialWorkflowState: WorkflowState = {
  bufferedEvents: 0,
  sentBatches: 0,
  sentEvents: 0,
  sentPageViews: 0,
  lastBatchSize: null,
  lastSentAt: null,
  lastError: null,
};

export function NavigationDebugPanel() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sdkE2EMode = searchParams.get("sdk-e2e");
  const [hash, setHash] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [logs, setLogs] = useState<NavigationLogEntry[]>([]);
  const [workflow, setWorkflow] = useState(initialWorkflowState);
  const initialConsent: AnalyticsConsent =
    process.env.NEXT_PUBLIC_ANALYTICS_CONSENT === "denied" ? "denied" : "granted";
  const [consent, setConsent] = useState<AnalyticsConsent>(initialConsent);
  const analyticsRef = useRef<ReturnType<typeof createBrowserAnalytics> | null>(null);
  const reportE2EErrors = useCallback((error: unknown) => {
    window.sessionStorage.setItem("__sdk_e2e_on_error_called", "true");
    throw new Error(`SDK E2E diagnostic callback: ${String(error)}`);
  }, []);

  const handleNavigation = useCallback((event: NavigationEvent) => {
    setCurrentUrl(event.url);
    setDocumentTitle(event.title ?? "");
    setLogs((currentLogs) => {
      const previousUrl = currentLogs[0]?.url ?? null;

      return [
        {
          ...event,
          timestamp: new Date(event.occurredAt).toISOString(),
          previousUrl,
        },
        ...currentLogs,
      ].slice(0, MAX_LOG_ENTRIES);
    });
  }, []);

  useEffect(() => {
    const updateHash = () => {
      setHash(window.location.hash);
      setCurrentUrl(window.location.href);
      setDocumentTitle(document.title);
    };

    updateHash();
    window.addEventListener("hashchange", updateHash);

    return () => window.removeEventListener("hashchange", updateHash);
  }, [sdkE2EMode]);

  useEffect(() => {
    if (sdkE2EMode === "invalid-config") {
      const analytics = createBrowserAnalytics({
        siteId: process.env.NEXT_PUBLIC_ANALYTICS_SITE_ID || "site_playground",
        endpoint: `${window.location.origin}/invalid-endpoint`,
        ingestKey: "e2e-invalid-config-key",
        onError: reportE2EErrors,
      });
      analyticsRef.current = analytics;
      return () => {
        analyticsRef.current = null;
        analytics.destroy();
      };
    }

    const onSend = (events: readonly AnalyticsEvent[]) => {
      setWorkflow((current) => ({
        ...current,
        sentBatches: current.sentBatches + 1,
        sentEvents: current.sentEvents + events.length,
        sentPageViews:
          current.sentPageViews + events.filter((event) => event.type === "page_view").length,
        lastBatchSize: events.length,
        lastSentAt: new Date().toISOString(),
      }));
    };

    let transport: Transport;
    try {
      transport = createPlaygroundTransport(
        {
          mode: process.env.NEXT_PUBLIC_ANALYTICS_TRANSPORT,
          endpoint: process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT,
          ingestKey: process.env.NEXT_PUBLIC_ANALYTICS_INGEST_KEY,
        },
        onSend,
      );
    } catch (error) {
      setWorkflow((current) => ({
        ...current,
        lastError: error instanceof Error ? error.message : String(error),
      }));

      return;
    }

    const analytics = createBrowserAnalytics({
      consent: initialConsent,
      siteId: process.env.NEXT_PUBLIC_ANALYTICS_SITE_ID || "site_playground",
      transport,
      onNavigation: handleNavigation,
      bufferSize: 1,
      onBufferChange: (bufferedEvents) =>
        setWorkflow((current) => ({ ...current, bufferedEvents })),
      onError:
        sdkE2EMode === "throw-on-error"
          ? reportE2EErrors
          : (error) =>
              setWorkflow((current) => ({
                ...current,
                lastError: error instanceof Error ? error.message : String(error),
              })),
    });
    analyticsRef.current = analytics;
    return () => {
      analyticsRef.current = null;
      analytics.destroy();
    };
  }, [handleNavigation, reportE2EErrors, sdkE2EMode]);

  const toggleConsent = () => {
    const nextConsent = consent === "granted" ? "denied" : "granted";
    analyticsRef.current?.setConsent(nextConsent);
    setConsent(nextConsent);
  };

  return (
    <>
      <section aria-label="Navigation debug panel">
        <h2>Navigation Debug Panel</h2>
        <button type="button" data-testid="consent-toggle" onClick={toggleConsent}>
          Consent: {consent}
        </button>
        <dl>
          <dt>Current URL</dt>
          <dd>{currentUrl || "Loading..."}</dd>
          <dt>Pathname</dt>
          <dd>{pathname}</dd>
          <dt>Search params</dt>
          <dd>{searchParams.toString() || "(none)"}</dd>
          <dt>Hash</dt>
          <dd>{hash || "(none)"}</dd>
          <dt>Document title</dt>
          <dd>{documentTitle || "Loading..."}</dd>
        </dl>

        <h3>Navigation Log</h3>
        {logs.length === 0 ? (
          <p>No navigation recorded yet.</p>
        ) : (
          <ol data-testid="events">
            {logs.map((entry, index) => (
              <li key={`${entry.timestamp}-${index}`}>
                <time dateTime={entry.timestamp}>{entry.timestamp}</time>{" "}
                <strong>{entry.navigationType}</strong>
                <div>Path: {entry.path}</div>
                <div>From: {entry.previousUrl || "(none)"}</div>
                <div>To: {entry.url}</div>
              </li>
            ))}
          </ol>
        )}
        <output data-testid="events-json">{JSON.stringify(logs)}</output>
      </section>
      <section aria-label="SDK workflow debug panel">
        <h2>SDK Workflow Debug Panel</h2>
        <dl>
          <dt>Buffered events</dt>
          <dd>{workflow.bufferedEvents}</dd>
          <dt>Sent batches</dt>
          <dd>{workflow.sentBatches}</dd>
          <dt>Sent events</dt>
          <dd>{workflow.sentEvents}</dd>
          <dt>Sent page views</dt>
          <dd data-testid="analytics-page-views">{workflow.sentPageViews}</dd>
          <output data-testid="analytics-events">{workflow.sentEvents}</output>
          <dt>Last batch size</dt>
          <dd>{workflow.lastBatchSize ?? "(none)"}</dd>
          <dt>Last sent at</dt>
          <dd>{workflow.lastSentAt ?? "(none)"}</dd>
          <dt>Last error</dt>
          <dd>{workflow.lastError ?? "(none)"}</dd>
        </dl>
      </section>
    </>
  );
}
