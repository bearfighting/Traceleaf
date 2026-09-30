import type { Capability as StoredCapability } from "./generated/capabilities";
import type { Capability as UpdatedCapability } from "./generated/capability-update";
import type { ConversionFunnelDefinitionSetUpdateSchema } from "./generated/conversion-funnel-definition-set-update";
import type { SiteEnvironmentIngestPolicy } from "./generated/environment-policy";

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;
type Rejects<From, To> = Assert<IsAssignable<From, To> extends false ? true : false>;

// These declarations compile as part of the package typecheck and emit no runtime code.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- this probes the generated empty-object contract.
type StoredSettingsAcceptEmptyObject = Assert<IsAssignable<{}, StoredCapability["settings"]>>;
type StoredSettingsRejectString = Rejects<string, StoredCapability["settings"]>;
type StoredSettingsRejectArray = Rejects<unknown[], StoredCapability["settings"]>;
type StoredSettingsRejectProperties = Rejects<
  { unexpected: boolean },
  StoredCapability["settings"]
>;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- this probes the generated empty-object contract.
type UpdateSettingsAcceptEmptyObject = Assert<IsAssignable<{}, UpdatedCapability["settings"]>>;
type UpdateSettingsRejectString = Rejects<string, UpdatedCapability["settings"]>;
type UpdateSettingsRejectProperties = Rejects<
  { unexpected: boolean },
  UpdatedCapability["settings"]
>;

// These probes document what generated structural types do and do not express.
type PolicyRejectsEmptyOrigins = Rejects<[], SiteEnvironmentIngestPolicy["allowed_origins"]>;
type PolicyRejectsUnsupportedSchemaVersion = Rejects<
  2,
  SiteEnvironmentIngestPolicy["schema_version"]
>;
type PolicyAllowsZeroVersionAtTypeLevel = Assert<
  IsAssignable<0, SiteEnvironmentIngestPolicy["version"]>
>;
type PolicyAllowsMalformedDateStringAtTypeLevel = Assert<
  IsAssignable<"not-a-date-time", SiteEnvironmentIngestPolicy["updated_at"]>
>;
type FunnelRejectsTooFewSteps = Rejects<
  [{ event_name: string }],
  ConversionFunnelDefinitionSetUpdateSchema["funnels"][number]["steps"]
>;
type FunnelAllowsArbitraryStringDefinitionIds = Assert<
  IsAssignable<string, ConversionFunnelDefinitionSetUpdateSchema["conversions"][number]["id"]>
>;
