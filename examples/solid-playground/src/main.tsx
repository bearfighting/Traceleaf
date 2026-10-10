import { createBrowserAnalytics } from "@traceleaf/browser";
import { createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { A, Route, Router, useLocation } from "@solidjs/router";

function App(props: { children?: JSX.Element }) {
  const [events, setEvents] = createSignal<unknown[]>([]);
  const location = useLocation();
  const analytics = createBrowserAnalytics({
    siteId: "solid-playground",
    consent: "granted",
    transport: { async sendBatch() {} },
    onNavigation: (event) => setEvents((current) => [...current, event]),
  });
  onCleanup(() => analytics.destroy());
  createEffect(() => {
    document.title = location.pathname === "/users/42" ? "Solid User" : "Solid Home";
  });
  return (
    <>
      <nav>
        <A href="/">Home</A> | <A href="/users/42">User</A>
      </nav>
      {props.children}
      <pre data-testid="events">{JSON.stringify(events())}</pre>
    </>
  );
}
render(
  () => (
    <Router root={App}>
      <Route
        path="/"
        component={() => (
          <>
            <h1>Solid Home</h1>
          </>
        )}
      />
      <Route
        path="/users/42"
        component={() => (
          <>
            <h1>Solid User</h1>
          </>
        )}
      />
    </Router>
  ),
  document.getElementById("root")!,
);
