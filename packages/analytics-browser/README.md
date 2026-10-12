# `@traceleaf/browser`

After registry publication, install the package in your application:

```sh
npm install @traceleaf/browser
```

The package is currently private and has not been published to a registry. To
create a local tarball from a clean checkout, build the package first, then pack
it from its directory:

```sh
pnpm --filter @traceleaf/browser build
cd packages/analytics-browser
npm pack
```

Install the resulting `.tgz` file from your consumer project for local
evaluation.

Browser SDK runtime for turning browser Navigation API entries into Protocol V1 page-view events.

Use `createBrowserAnalytics()` for a framework-independent setup. It starts the Navigation API observer automatically and releases its subscription when `destroy()` is called. Supply either `siteId`, `endpoint`, and `ingestKey` to use the built-in Fetch transport, or provide a custom `transport`. The SDK does not read environment variables; applications should read their own configuration and pass the values in:

```js
import { createBrowserAnalytics } from "@traceleaf/browser";

const analytics = createBrowserAnalytics({
  siteId: "site_example",
  endpoint: "https://collector.example/v1/events",
  ingestKey: "public-ingest-key",
  consent: "denied",
});

analytics.setConsent("granted"); // Call when the user's consent settings allow collection.
```

Invalid or incomplete configuration disables the instance without starting the observer or collecting data. If `onError` is provided, it receives one initialization error; otherwise the SDK stays silent. A disabled instance remains disabled if consent changes, so create a new instance after correcting configuration. `consent` defaults to `"denied"`.

For tests and custom delivery, pass a transport instead of `endpoint` and `ingestKey`:

```ts
const analytics = createBrowserAnalytics({ siteId: "site_example", transport });
```

This package supports injectable context, `beforeSend`, a bounded in-memory buffer, scheduled/manual flush, and custom transports. Its built-in Fetch transport sends batches to the Collector. It does not implement persistence or retries.
