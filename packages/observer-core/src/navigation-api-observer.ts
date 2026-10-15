import type { NavigationObserver, NavigationType } from "./types";

interface NavigationEntryLike {
  url: string;
  key: string;
}

interface NavigationChangeEventLike extends Event {
  navigationType: "push" | "replace" | "traverse" | null;
  from?: NavigationEntryLike | null;
}

interface NavigationRequestEventLike extends Event {
  destination: { url: string; key: string };
  navigationType: "push" | "replace" | "traverse" | "reload";
  hashChange: boolean;
  signal: AbortSignal;
}

interface NavigationTargetLike extends EventTarget {
  currentEntry: NavigationEntryLike | null;
}

interface BrowserLocationLike {
  href: string;
  pathname: string;
}

interface NavigationApiEnvironment {
  navigation?: NavigationTargetLike;
  location: BrowserLocationLike;
  title?: string;
  referrer?: string;
}

export interface NavigationApiObserverOptions {
  /** Primarily useful for deterministic tests; normal consumers use the browser globals. */
  environment?: NavigationApiEnvironment;
  now?: () => number;
  schedule?: (callback: () => void) => unknown;
  titleWaitMs?: number;
}

const routeIdentity = (url: URL) => `${url.pathname}${url.search}`;

function browserEnvironment(): NavigationApiEnvironment | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") return undefined;

  return {
    navigation: (window as Window & { navigation?: NavigationTargetLike }).navigation,
    location: window.location,
    get title() {
      return document.title || undefined;
    },
    get referrer() {
      return document.referrer || undefined;
    },
  };
}

function mapNavigationType(
  type: NavigationChangeEventLike["navigationType"] | NavigationRequestEventLike["navigationType"],
): NavigationType | null {
  if (type === "push" || type === "replace") return type;
  if (type === "traverse") return "pop";

  return null;
}

/** Observes committed same-document navigations through the browser Navigation API. */
export function createNavigationApiObserver(
  options: NavigationApiObserverOptions = {},
): NavigationObserver {
  const environment = options.environment ?? browserEnvironment();
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback) => setTimeout(callback, 0));
  const titleWaitMs = options.titleWaitMs ?? 500;

  return {
    subscribe(listener) {
      if (!environment) return () => {};

      let previousIdentity: string | null = null;
      let previousTitle: string | undefined;
      let lastOccurredAt = Number.NEGATIVE_INFINITY;
      let active = true;
      const navigation = environment.navigation;
      const pendingTitleWaits = new Set<() => void>();
      const pendingNavigations: Array<{
        href: string;
        navigationType: NavigationType;
        occurredAt: number;
        fromKey: string;
        titleBeforeNavigation?: string;
        titleReliable: boolean;
        ready: boolean;
        cancelled: boolean;
        signalAborted: boolean;
      }> = [];
      const emit = (
        href: string,
        navigationType: NavigationType,
        titleReliable = true,
        occurredAt = now(),
      ) => {
        if (!active) return;
        let destination: URL;
        try {
          destination = new URL(href, environment.location.href);
        } catch {
          return;
        }

        const identity = routeIdentity(destination);
        if (previousIdentity !== null && previousIdentity === identity) return;
        previousIdentity = identity;
        occurredAt = Math.max(occurredAt, lastOccurredAt + 1);
        lastOccurredAt = occurredAt;
        const currentHref = navigation?.currentEntry?.url ?? environment.location.href;
        let titleBelongsToEntry = false;
        try {
          titleBelongsToEntry =
            routeIdentity(new URL(currentHref, environment.location.href)) === identity;
        } catch {
          // An invalid current URL must not prevent reporting a valid committed entry.
        }
        const title = titleReliable && titleBelongsToEntry ? environment.title : undefined;
        const eventTitle =
          navigationType === "initial" || title !== previousTitle ? title : undefined;
        if (titleReliable && titleBelongsToEntry) previousTitle = title;

        listener({
          url: destination.href,
          path: destination.pathname,
          title: eventTitle,
          referrer: environment.referrer,
          navigationType,
          occurredAt,
        });
      };
      const emitReadyNavigations = () => {
        while (pendingNavigations[0]?.ready || pendingNavigations[0]?.cancelled) {
          const pendingNavigation = pendingNavigations.shift();
          if (!pendingNavigation) return;
          if (pendingNavigation.cancelled) continue;
          emit(
            pendingNavigation.href,
            pendingNavigation.navigationType,
            pendingNavigation.titleReliable,
            pendingNavigation.occurredAt,
          );
        }
      };
      const scheduleNavigationEmission = (
        pendingNavigation: (typeof pendingNavigations)[number],
      ) => {
        schedule(() => {
          if (!active) return;
          const titleBeforeNavigation = pendingNavigation.titleBeforeNavigation;
          if (
            (environment.title && environment.title !== titleBeforeNavigation) ||
            titleWaitMs <= 0
          ) {
            pendingNavigation.ready = true;
            emitReadyNavigations();

            return;
          }

          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            if (poll) clearInterval(poll);
            pendingTitleWaits.delete(cancel);
            pendingNavigation.ready = true;
            emitReadyNavigations();
          };
          const cancel = () => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            if (poll) clearInterval(poll);
          };
          pendingTitleWaits.add(cancel);
          const poll = setInterval(() => {
            if (environment.title && environment.title !== titleBeforeNavigation) finish();
          }, 20);
          const timeout = setTimeout(finish, titleWaitMs);
        });
      };

      const handleNavigate: EventListener = (rawEvent) => {
        const event = rawEvent as NavigationRequestEventLike;
        const navigationType = mapNavigationType(event.navigationType);
        if (!navigationType || event.hashChange || !navigation?.currentEntry) {
          return;
        }

        let target: URL;
        let current: URL;
        try {
          target = new URL(event.destination.url, environment.location.href);
          current = new URL(navigation.currentEntry.url, environment.location.href);
        } catch {
          return;
        }
        if (routeIdentity(target) === routeIdentity(current)) return;

        const currentEntryKey = navigation.currentEntry.key;
        pendingNavigations.forEach((pending) => {
          if (pending.signalAborted && pending.fromKey === currentEntryKey) {
            pending.cancelled = true;
          }
        });
        const committedPendingNavigation = pendingNavigations.find(
          (pending) => !pending.cancelled && pending.fromKey !== currentEntryKey,
        );
        if (committedPendingNavigation) {
          committedPendingNavigation.titleReliable = false;
        }
        const pendingNavigation = {
          href: target.href,
          navigationType,
          // The timestamp is filled when currententrychange confirms this navigation committed.
          occurredAt: 0,
          fromKey: currentEntryKey,
          titleBeforeNavigation: environment.title,
          titleReliable: committedPendingNavigation === undefined,
          ready: false,
          cancelled: false,
          signalAborted: false,
        };
        if (committedPendingNavigation) pendingNavigation.titleReliable = false;
        pendingNavigations.push(pendingNavigation);
        // A later navigation may replace this request before it commits. Its abort signal is
        // used to discard it when the current entry changes.
        event.signal.addEventListener(
          "abort",
          () => {
            pendingNavigation.signalAborted = true;
          },
          { once: true },
        );
      };

      const handleCurrentEntryChange: EventListener = (rawEvent) => {
        const changeEvent = rawEvent as NavigationChangeEventLike;
        const type = mapNavigationType(changeEvent.navigationType);
        if (!type) return;

        const href = navigation?.currentEntry?.url;
        if (!href) return;
        const candidateNavigations = pendingNavigations.filter(
          (pending) =>
            !pending.cancelled &&
            pending.fromKey === changeEvent.from?.key &&
            pending.navigationType === type,
        );
        const currentIdentity = routeIdentity(new URL(href, environment.location.href));
        let pendingNavigation =
          candidateNavigations.find(
            (pending) =>
              routeIdentity(new URL(pending.href, environment.location.href)) === currentIdentity,
          ) ??
          candidateNavigations.find((pending) => !pending.signalAborted) ??
          candidateNavigations.at(-1);
        if (!pendingNavigation) {
          const previousUrl = changeEvent.from?.url;
          if (!previousUrl) return;
          let previousIdentity: string;
          try {
            previousIdentity = routeIdentity(new URL(previousUrl, environment.location.href));
          } catch {
            return;
          }
          if (previousIdentity === currentIdentity) return;
          pendingNavigation = {
            href,
            navigationType: type,
            occurredAt: 0,
            fromKey: changeEvent.from?.key ?? "",
            titleBeforeNavigation: previousTitle ?? environment.title,
            titleReliable: true,
            ready: false,
            cancelled: false,
            signalAborted: false,
          };
          pendingNavigations.push(pendingNavigation);
        }
        pendingNavigation.occurredAt = now();
        candidateNavigations.forEach((candidate) => {
          if (candidate !== pendingNavigation && candidate.signalAborted && !candidate.ready) {
            candidate.cancelled = true;
          }
        });
        emitReadyNavigations();
        scheduleNavigationEmission(pendingNavigation);
      };

      navigation?.addEventListener("navigate", handleNavigate);
      navigation?.addEventListener("currententrychange", handleCurrentEntryChange);
      const initialUrl = navigation?.currentEntry?.url ?? environment.location.href;
      schedule(() => emit(initialUrl, "initial"));

      return () => {
        active = false;
        navigation?.removeEventListener("navigate", handleNavigate);
        navigation?.removeEventListener("currententrychange", handleCurrentEntryChange);
        pendingTitleWaits.forEach((cancel) => cancel());
        pendingTitleWaits.clear();
      };
    },
  };
}
