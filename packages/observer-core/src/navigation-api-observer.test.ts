import { describe, expect, it, vi } from "vitest";

import { createNavigationApiObserver } from "./navigation-api-observer";

class FakeNavigation extends EventTarget {
  currentEntry: { url: string; key: string } | null = {
    url: "https://example.test/",
    key: "entry-0",
  };
  private nextKey = 1;
  private historyEntries = [this.currentEntry];

  commit(url: string, navigationType: "push" | "replace" | "traverse" | null) {
    if (!navigationType) {
      this.dispatchChange(this.currentEntry, null);

      return;
    }
    const pending = this.beginNavigation(url, navigationType);
    const event = pending.commit();
    this.dispatchEvent(event);
  }

  changeEntryWithoutNavigate(url: string, navigationType: "push" | "replace" | "traverse") {
    const from = this.currentEntry;
    this.currentEntry = { url, key: `entry-${this.nextKey++}` };
    if (navigationType === "replace")
      this.historyEntries[this.historyEntries.length - 1] = this.currentEntry;
    else this.historyEntries.push(this.currentEntry);
    const event = new Event("currententrychange");
    Object.defineProperties(event, {
      navigationType: { value: navigationType },
      from: { value: from },
    });
    this.dispatchEvent(event);
  }

  entries() {
    return this.historyEntries;
  }

  beginNavigation(url: string, navigationType: "push" | "replace" | "traverse") {
    const from = this.currentEntry;
    const controller = new AbortController();
    const request = new Event("navigate");
    Object.defineProperties(request, {
      destination: { value: { url, sameDocument: true, key: "" } },
      navigationType: { value: navigationType },
      hashChange: { value: false },
      signal: { value: controller.signal },
    });
    this.dispatchEvent(request);

    return {
      commit: () => {
        this.currentEntry = { url, key: `entry-${this.nextKey++}` };
        if (navigationType === "replace")
          this.historyEntries[this.historyEntries.length - 1] = this.currentEntry;
        else this.historyEntries.push(this.currentEntry);
        const event = new Event("currententrychange");
        Object.defineProperties(event, {
          navigationType: { value: navigationType },
          from: { value: from },
        });

        return event;
      },
      abort: () => controller.abort(),
    };
  }

  private dispatchChange(from: { url: string; key: string } | null, navigationType: null) {
    const event = new Event("currententrychange");
    Object.defineProperties(event, {
      navigationType: { value: navigationType },
      from: { value: from },
    });
    this.dispatchEvent(event);
  }
}

describe("Navigation API observer", () => {
  it("emits the initial entry and committed route changes with mapped types", () => {
    const navigation = new FakeNavigation();
    const scheduled: Array<() => void> = [];
    const listener = vi.fn();
    const environment = {
      navigation,
      location: { href: "https://example.test/", pathname: "/" },
      title: "Example",
      referrer: "https://referrer.test/",
    };
    const observer = createNavigationApiObserver({
      environment,
      now: () => 123,
      schedule: (callback) => scheduled.push(callback),
      titleWaitMs: 0,
    });

    const unsubscribe = observer.subscribe(listener);
    scheduled[0]?.();
    expect(listener).toHaveBeenCalledWith({
      url: "https://example.test/",
      path: "/",
      title: "Example",
      referrer: "https://referrer.test/",
      navigationType: "initial",
      occurredAt: 123,
    });

    navigation.commit("https://example.test/users/42?tab=activity", "push");
    environment.title = "Users";
    scheduled[1]?.();
    navigation.commit("https://example.test/search?q=router", "replace");
    environment.title = "Search";
    scheduled[2]?.();
    navigation.commit("https://example.test/", "traverse");
    environment.title = "Example";
    scheduled[3]?.();
    expect(listener).toHaveBeenCalledTimes(4);
    expect(listener.mock.calls[1]?.[0].title).toBe("Users");
    expect(
      listener.mock.calls.slice(1).map(([event]) => [event.path, event.navigationType]),
    ).toEqual([
      ["/users/42", "push"],
      ["/search", "replace"],
      ["/", "pop"],
    ]);

    unsubscribe();
    navigation.commit("https://example.test/after-unsubscribe", "push");
    scheduled.slice(4).forEach((callback) => callback());
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("ignores hash-only, same-route, and state-only entry changes", () => {
    const navigation = new FakeNavigation();
    const scheduled: Array<() => void> = [];
    const listener = vi.fn();
    const observer = createNavigationApiObserver({
      environment: {
        navigation,
        location: { href: "https://example.test/", pathname: "/" },
      },
      schedule: (callback) => scheduled.push(callback),
      titleWaitMs: 0,
    });

    observer.subscribe(listener);
    scheduled[0]?.();
    navigation.commit("https://example.test/#section", "push");
    navigation.commit("https://example.test/", "replace");
    navigation.commit("https://example.test/", null);
    scheduled.forEach((callback) => callback());

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("observes committed Navigation API entry changes without a navigate event", () => {
    const navigation = new FakeNavigation();
    const scheduled: Array<() => void> = [];
    const listener = vi.fn();
    const environment = {
      navigation,
      location: { href: "https://example.test/", pathname: "/" },
      title: "Example",
    };
    const observer = createNavigationApiObserver({
      environment,
      now: () => 456,
      schedule: (callback) => scheduled.push(callback),
      titleWaitMs: 0,
    });

    observer.subscribe(listener);
    scheduled.shift()?.();
    navigation.changeEntryWithoutNavigate("https://example.test/users/42", "push");
    scheduled.shift()?.();

    expect(listener.mock.calls.map(([event]) => [event.path, event.navigationType])).toEqual([
      ["/", "initial"],
      ["/users/42", "push"],
    ]);
    expect(listener.mock.calls[1]?.[0].title).toBeUndefined();
    expect(listener.mock.calls[1]?.[0].occurredAt).toBe(457);
  });

  it("emits only the initial entry when Navigation API is unavailable", () => {
    const listener = vi.fn();
    const scheduled: Array<() => void> = [];
    const observer = createNavigationApiObserver({
      environment: { location: { href: "https://example.test/start", pathname: "/start" } },
      schedule: (callback) => scheduled.push(callback),
    });

    observer.subscribe(listener);
    scheduled[0]?.();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0].navigationType).toBe("initial");
  });

  it("does not emit an initial entry for a subscription removed before its scheduled start", () => {
    const navigation = new FakeNavigation();
    const scheduled: Array<() => void> = [];
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const observer = createNavigationApiObserver({
      environment: {
        navigation,
        location: { href: "https://example.test/", pathname: "/" },
      },
      schedule: (callback) => scheduled.push(callback),
    });

    const unsubscribeFirst = observer.subscribe(firstListener);
    unsubscribeFirst();
    observer.subscribe(secondListener);
    scheduled.forEach((callback) => callback());

    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(secondListener.mock.calls[0]?.[0].navigationType).toBe("initial");
  });

  it("does not attach a later route title to an earlier rapid navigation", () => {
    vi.useFakeTimers();
    try {
      const navigation = new FakeNavigation();
      const listener = vi.fn();
      const environment = {
        navigation,
        location: { href: "https://example.test/", pathname: "/" },
        title: "Initial title",
      };
      const observer = createNavigationApiObserver({
        environment,
        titleWaitMs: 500,
      });

      observer.subscribe(listener);
      vi.advanceTimersByTime(0);
      navigation.commit("https://example.test/first", "push");
      navigation.commit("https://example.test/second", "push");
      vi.advanceTimersByTime(0);
      environment.title = "";
      vi.advanceTimersByTime(20);
      expect(listener).toHaveBeenCalledTimes(1);
      environment.title = "Second page title";
      vi.advanceTimersByTime(20);

      expect(listener.mock.calls.map(([event]) => [event.url, event.title])).toEqual([
        ["https://example.test/", "Initial title"],
        ["https://example.test/first", undefined],
        ["https://example.test/second", undefined],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps subscriptions independent and only unsubscribes the selected listener", () => {
    const navigation = new FakeNavigation();
    const scheduled: Array<() => void> = [];
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const observer = createNavigationApiObserver({
      environment: {
        navigation,
        location: { href: "https://example.test/", pathname: "/" },
      },
      schedule: (callback) => scheduled.push(callback),
      titleWaitMs: 0,
    });

    const unsubscribeFirst = observer.subscribe(firstListener);
    observer.subscribe(secondListener);
    scheduled.splice(0).forEach((callback) => callback());
    navigation.commit("https://example.test/first", "push");
    scheduled.splice(0).forEach((callback) => callback());
    unsubscribeFirst();
    navigation.commit("https://example.test/second", "replace");
    scheduled.splice(0).forEach((callback) => callback());

    expect(firstListener.mock.calls.map(([event]) => event.navigationType)).toEqual([
      "initial",
      "push",
    ]);
    expect(secondListener.mock.calls.map(([event]) => event.navigationType)).toEqual([
      "initial",
      "push",
      "replace",
    ]);
  });

  it("reports rapid committed navigations in commit order and timestamps the commits", () => {
    vi.useFakeTimers();
    try {
      const navigation = new FakeNavigation();
      const listener = vi.fn();
      const environment = {
        navigation,
        location: { href: "https://example.test/", pathname: "/" },
        title: "Initial title",
      };
      let timestamp = 100;
      const observer = createNavigationApiObserver({
        environment,
        now: () => timestamp,
        titleWaitMs: 500,
      });

      observer.subscribe(listener);
      vi.advanceTimersByTime(0);
      timestamp = 101;
      navigation.commit("https://example.test/first", "push");
      vi.advanceTimersByTime(0);
      environment.title = "First page title";
      timestamp = 102;
      navigation.commit("https://example.test/second", "push");
      environment.title = "Second page title";
      vi.advanceTimersByTime(0);

      expect(listener.mock.calls.map(([event]) => event.url)).toEqual(["https://example.test/"]);
      vi.advanceTimersByTime(20);

      expect(listener.mock.calls.map(([event]) => event.url)).toEqual([
        "https://example.test/",
        "https://example.test/first",
        "https://example.test/second",
      ]);
      expect(listener.mock.calls.map(([event]) => event.occurredAt)).toEqual([100, 101, 102]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves navigation request order when current entry change notifications arrive reversed", () => {
    const navigation = new FakeNavigation();
    const scheduled: Array<() => void> = [];
    const listener = vi.fn();
    const environment = {
      navigation,
      location: { href: "https://example.test/", pathname: "/" },
      title: "Initial title",
    };
    let timestamp = 100;
    const observer = createNavigationApiObserver({
      environment,
      now: () => timestamp,
      schedule: (callback) => scheduled.push(callback),
      titleWaitMs: 0,
    });

    observer.subscribe(listener);
    scheduled.splice(0).forEach((callback) => callback());
    timestamp = 101;
    const first = navigation.beginNavigation("https://example.test/first", "push");
    const firstChange = first.commit();
    timestamp = 102;
    const second = navigation.beginNavigation("https://example.test/second", "push");
    const secondChange = second.commit();

    timestamp = 104;
    navigation.dispatchEvent(secondChange);
    timestamp = 108;
    navigation.dispatchEvent(firstChange);
    scheduled.splice(0).forEach((callback) => callback());

    expect(listener.mock.calls.map(([event]) => event.url)).toEqual([
      "https://example.test/",
      "https://example.test/first",
      "https://example.test/second",
    ]);
    expect(listener.mock.calls.map(([event]) => event.occurredAt)).toEqual([100, 108, 109]);
  });

  it("drops a cancelled navigation before emitting the next committed navigation", () => {
    const navigation = new FakeNavigation();
    const scheduled: Array<() => void> = [];
    const listener = vi.fn();
    const observer = createNavigationApiObserver({
      environment: {
        navigation,
        location: { href: "https://example.test/", pathname: "/" },
      },
      schedule: (callback) => scheduled.push(callback),
      titleWaitMs: 0,
    });

    observer.subscribe(listener);
    scheduled.splice(0).forEach((callback) => callback());
    const cancelled = navigation.beginNavigation("https://example.test/cancelled", "push");
    cancelled.abort();
    navigation.commit("https://example.test/committed", "push");
    scheduled.splice(0).forEach((callback) => callback());

    expect(listener.mock.calls.map(([event]) => event.url)).toEqual([
      "https://example.test/",
      "https://example.test/committed",
    ]);
  });

  it("keeps a cancelled navigation from suppressing the next committed title", () => {
    const navigation = new FakeNavigation();
    const scheduled: Array<() => void> = [];
    const listener = vi.fn();
    const environment = {
      navigation,
      location: { href: "https://example.test/", pathname: "/" },
      title: "Initial title",
    };
    const observer = createNavigationApiObserver({
      environment,
      schedule: (callback) => scheduled.push(callback),
      titleWaitMs: 0,
    });

    observer.subscribe(listener);
    scheduled.splice(0).forEach((callback) => callback());
    const cancelled = navigation.beginNavigation("https://example.test/cancelled", "push");
    cancelled.abort();
    environment.title = "Committed page title";
    navigation.commit("https://example.test/committed", "push");
    scheduled.splice(0).forEach((callback) => callback());

    expect(listener.mock.calls.map(([event]) => [event.url, event.title])).toEqual([
      ["https://example.test/", "Initial title"],
      ["https://example.test/committed", "Committed page title"],
    ]);
  });
});
