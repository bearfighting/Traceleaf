# @web-analytics/observer-core

Framework-neutral navigation contracts, the in-memory observer used by tests
and development, and the browser Navigation API observer used by the Browser
SDK.

The browser observer reports the initial document and committed same-document
navigation entries. It does not depend on a Router library or intercept
navigations. When the Navigation API is unavailable, it reports only the initial
document. Shared navigation helpers preserve the `NavigationObserver` contract
across browser and in-memory observers.
