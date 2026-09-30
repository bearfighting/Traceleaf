import type { CustomEvent } from "./custom-event";
import type { EventBatch } from "./event-batch";
import type { PageViewEvent } from "./page-view-event";
import type { WebVitalEvent } from "./web-vital-event";
export type { EventBatch } from "./event-batch";
export type { CustomEvent, CustomEventProperty } from "./custom-event";
export { validateCustomEventProperties } from "./custom-event";
export type { PageViewEvent } from "./page-view-event";
export type {
  WebVitalEvent,
  WebVitalMetric,
  WebVitalRating,
  WebVitalNavigationType,
} from "./web-vital-event";
export { WEB_VITAL_METRICS, isWebVitalEvent, webVitalRating } from "./web-vital-event";
export type { BrowserContextV1, ContextDimension, UnknownContextValue } from "./browser-context-v1";
export type AnalyticsEvent = PageViewEvent | CustomEvent | WebVitalEvent;
export type AnalyticsEventBatch = EventBatch;

export type {
  SiteEnvironmentIngestPolicy,
  StoredKey as StoredIngestKey,
} from "./generated/environment-policy";
export type {
  SiteCapabilityConfiguration,
  Capability as SiteCapability,
} from "./generated/capabilities";
export type {
  SiteCapabilityUpdate,
  Capability as CapabilitySetting,
} from "./generated/capability-update";
export type { EnvironmentIngestPolicyUpdate } from "./generated/environment-policy-update";
export type {
  ConversionFunnelDefinitionSetUpdateSchema as ConversionFunnelDefinitionSetUpdate,
  Conversion,
  Funnel,
  Step as FunnelStep,
} from "./generated/conversion-funnel-definition-set-update";
