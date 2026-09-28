# Phase 7 PR4: Web Vitals

## Contract

Event Protocol V1 adds `web_vital`. It is emitted only with granted consent after a Page View has been created. Its immutable association fields identify the Page View and preserve the Page View pathname/time. The supported metrics are LCP, INP, CLS, FCP and TTFB from the standard `web-vitals@6.2.2` build. SPA soft navigation and attribution are out of scope. Missing browser APIs or callbacks result in no sample. Repeated callbacks increment a per-Page-View sequence; downstream facts retain the largest sequence.

Time values are milliseconds in [0, 600000], CLS is in [0, 100]. Thresholds are LCP 2500/4000, INP 200/500, CLS 0.1/0.25, FCP 1800/3000, and TTFB 800/1800 for good/needs-improvement boundaries. Collector rejects mismatched ratings.

## Storage and reporting

Raw payloads are preserved. `web_vital_facts` stores the latest report per site, Page View and metric; properties and visitor identifiers are not part of this event. Web Vitals have an independent processor watermark and do not affect Page View, visitor, session, context or dimensions. Report dates use the associated Page View UTC date. API output contains route/metric counts, discrete nearest-rank p75 and rating counts. p75 is null and status is `insufficient_data` for fewer than four samples.

## Delivery

When the document becomes hidden, the Browser SDK requests a keepalive flush. Collector/migration must be deployed before SDKs emitting `web_vital`.
