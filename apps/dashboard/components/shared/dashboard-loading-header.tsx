"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useSyncExternalStore } from "react";

import {
  dashboardRoute,
  settingsRoute,
  type SettingsRouteContext,
} from "../../lib/settings/settings-routes";
import { DashboardHeader } from "../shared/dashboard-shell";

export function DashboardLoadingHeader({ settingsMode = false }: { settingsMode?: boolean }) {
  return (
    <Suspense fallback={<DashboardLoadingFallbackHeader settingsMode={settingsMode} />}>
      <DashboardLoadingHeaderContent settingsMode={settingsMode} />
    </Suspense>
  );
}

function contextFromSearchParams(searchParams: Pick<URLSearchParams, "get">): SettingsRouteContext {
  return {
    siteId: searchParams.get("site_id") ?? undefined,
    environment: searchParams.get("environment") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    dimension: searchParams.get("dimension") ?? undefined,
    definitionVersion: searchParams.get("definition_version") ?? undefined,
  };
}

function settingsOverviewContext(context: SettingsRouteContext): SettingsRouteContext {
  return {
    siteId: context.siteId,
    environment: context.environment,
    from: context.from,
    to: context.to,
  };
}

let locationSubscribers = 0;
let originalPushState: History["pushState"] | undefined;
let originalReplaceState: History["replaceState"] | undefined;
let wrappedPushState: History["pushState"] | undefined;
let wrappedReplaceState: History["replaceState"] | undefined;

function notifyLocationChange() {
  window.dispatchEvent(new Event("dashboard:locationchange"));
}

function subscribeToLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener("dashboard:locationchange", onChange);

  if (locationSubscribers === 0) {
    originalPushState = window.history.pushState;
    originalReplaceState = window.history.replaceState;
    const pushState = originalPushState;
    const replaceState = originalReplaceState;
    wrappedPushState = function (this: History, ...args) {
      pushState.apply(this, args);
      notifyLocationChange();
    };
    wrappedReplaceState = function (this: History, ...args) {
      replaceState.apply(this, args);
      notifyLocationChange();
    };
    window.history.pushState = wrappedPushState;
    window.history.replaceState = wrappedReplaceState;
  }
  locationSubscribers += 1;

  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("dashboard:locationchange", onChange);
    locationSubscribers -= 1;

    if (locationSubscribers === 0) {
      if (wrappedPushState && window.history.pushState === wrappedPushState && originalPushState) {
        window.history.pushState = originalPushState;
      }
      if (
        wrappedReplaceState &&
        window.history.replaceState === wrappedReplaceState &&
        originalReplaceState
      ) {
        window.history.replaceState = originalReplaceState;
      }
      originalPushState = undefined;
      originalReplaceState = undefined;
      wrappedPushState = undefined;
      wrappedReplaceState = undefined;
    }
  };
}

function getLocationSearch() {
  return window.location.search;
}

function getServerLocationSearch() {
  return "";
}

function DashboardLoadingFallbackHeader({ settingsMode }: { settingsMode: boolean }) {
  const search = useSyncExternalStore(
    subscribeToLocation,
    getLocationSearch,
    getServerLocationSearch,
  );
  const context = contextFromSearchParams(new URLSearchParams(search));

  return (
    <DashboardHeader
      settingsMode={settingsMode}
      analyticsHref={dashboardRoute(context)}
      settingsHref={settingsRoute("overview", settingsOverviewContext(context))}
    />
  );
}

function DashboardLoadingHeaderContent({ settingsMode = false }: { settingsMode?: boolean }) {
  const searchParams = useSearchParams();
  const context = contextFromSearchParams(searchParams);

  return (
    <DashboardHeader
      settingsMode={settingsMode}
      analyticsHref={dashboardRoute(context)}
      settingsHref={settingsRoute("overview", settingsOverviewContext(context))}
    />
  );
}
