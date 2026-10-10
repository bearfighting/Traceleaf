import { createBrowserAnalytics } from "@traceleaf/browser";
import { createPlaygroundTransport } from "@web-analytics/playground-support";

const navigationEvents = [];
const analyticsEvents = [];
const secondInstanceEvents = [];
const eventsOutput = document.querySelector('[data-testid="events-json"]');
const analyticsOutput = document.querySelector('[data-testid="analytics-events"]');
const pageViewsOutput = document.querySelector('[data-testid="analytics-page-views"]');
const secondPageViewsOutput = document.querySelector('[data-testid="second-instance-page-views"]');
const titleOutput = document.querySelector('[data-testid="page-title"]');
const urlOutput = document.querySelector('[data-testid="current-url"]');
const instanceCountOutput = document.querySelector('[data-testid="active-instances"]');
const consentButton = document.querySelector('[data-testid="consent-toggle"]');

function render() {
  eventsOutput.textContent = JSON.stringify(navigationEvents);
  analyticsOutput.textContent = JSON.stringify(analyticsEvents);
  pageViewsOutput.textContent = String(countPageViews(analyticsEvents));
  secondPageViewsOutput.textContent = String(countPageViews(secondInstanceEvents));
  titleOutput.textContent = document.title;
  urlOutput.textContent = window.location.href;
}

function countPageViews(events) {
  return events.filter((event) => event.type === "page_view").length;
}

function createTransport(receivedEvents) {
  return createPlaygroundTransport(
    {
      mode: "mock",
      siteId: "vanilla-navigation-playground",
    },
    (batch) => {
      receivedEvents.push(...batch);
      render();
    },
  );
}

const siteId = "vanilla-navigation-playground";
let consent = import.meta.env.NEXT_PUBLIC_ANALYTICS_CONSENT === "denied" ? "denied" : "granted";
const primaryAnalytics = createBrowserAnalytics({
  consent,
  siteId,
  transport: createTransport(analyticsEvents),
  bufferSize: 1,
  onNavigation(event) {
    navigationEvents.push(event);
    render();
  },
});
let secondaryAnalytics = createBrowserAnalytics({
  consent,
  siteId,
  transport: createTransport(secondInstanceEvents),
  bufferSize: 1,
});
consentButton.textContent = `Consent: ${consent}`;
consentButton.addEventListener("click", () => {
  consent = consent === "granted" ? "denied" : "granted";
  primaryAnalytics.setConsent(consent);
  secondaryAnalytics?.setConsent(consent);
  consentButton.textContent = `Consent: ${consent}`;
});

function pageUrl(page, query = "") {
  const url = new URL(window.location.href);
  url.pathname = `/${page}`;
  url.search = query;
  url.hash = "";
  return url.href;
}

function interceptTarget(targetUrl, handler) {
  const intercept = (event) => {
    if (event.destination.url !== targetUrl) return;
    window.navigation.removeEventListener("navigate", intercept);
    event.intercept({
      handler: async () => {
        if (handler) await handler();
        const pathname = new URL(targetUrl).pathname.replace(/^\//, "") || "Home";
        document.title = pathname[0].toUpperCase() + pathname.slice(1);
      },
    });
  };
  window.navigation.addEventListener("navigate", intercept);
}

document.querySelectorAll("[data-navigation]").forEach((button) => {
  button.addEventListener("click", async () => {
    const action = button.dataset.navigation;
    if (action === "back") return window.navigation.back();
    if (action === "forward") return window.navigation.forward();
    if (action === "hash") return window.navigation.navigate(`${window.location.href}#section`);

    const target =
      action === "search"
        ? pageUrl("search", `?query=${Date.now()}`)
        : pageUrl(action === "replace" ? "replaced" : action === "push" ? "page" : action);

    if (action === "cancel") {
      const cancel = (event) => {
        if (event.destination.url !== target) return;
        window.navigation.removeEventListener("navigate", cancel);
        event.preventDefault();
      };
      window.navigation.addEventListener("navigate", cancel);
      try {
        await window.navigation.navigate(target).finished;
      } catch {
        // The canceled navigation intentionally leaves the current entry unchanged.
      }
      return;
    }

    if (action === "reject") {
      try {
        window.navigation.navigate(target, { history: "invalid" });
      } catch {
        return;
      }
      return;
    }

    if (action === "fail") {
      interceptTarget(target, async () => {
        throw new Error("Controlled post-commit failure");
      });
      try {
        await window.navigation.navigate(target).finished;
      } catch {
        // The entry remains committed and should still be observed.
      }
      return;
    }

    if (action === "rapid") {
      const first = pageUrl("rapid", "?step=first");
      const second = pageUrl("rapid", "?step=second");
      interceptTarget(first);
      interceptTarget(second);
      const firstNavigation = window.navigation.navigate(first);
      await firstNavigation.committed;
      await new Promise((resolve) => setTimeout(resolve, 2));
      const secondNavigation = window.navigation.navigate(second);
      await Promise.allSettled([firstNavigation.finished, secondNavigation.finished]);
      document.title = "Rapid navigation final title";
      render();
      return;
    }

    if (action === "replace") {
      interceptTarget(target);
      window.navigation.navigate(target, { history: "replace" });
      return;
    }

    interceptTarget(target);
    window.navigation.navigate(target);
  });
});

document.querySelector('[data-testid="remove-second-instance"]').addEventListener("click", () => {
  secondaryAnalytics.destroy();
  secondaryAnalytics = null;
  instanceCountOutput.textContent = "1";
});

window.navigation.addEventListener("currententrychange", () => {
  const pathname = window.location.pathname.replace(/^\//, "") || "Home";
  document.title = pathname[0].toUpperCase() + pathname.slice(1);
  render();
});

window.addEventListener("hashchange", render);
render();

window.addEventListener("beforeunload", () => {
  primaryAnalytics.destroy();
  secondaryAnalytics?.destroy();
});
