import type { Capability as StoredCapability } from "./generated/capabilities";
import type { Capability as UpdatedCapability } from "./generated/capability-update";

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;
type Rejects<From, To> = Assert<IsAssignable<From, To> extends false ? true : false>;

// These declarations compile as part of the package typecheck and emit no runtime code.
type StoredSettingsAcceptEmptyObject = Assert<IsAssignable<{}, StoredCapability["settings"]>>;
type StoredSettingsRejectString = Rejects<string, StoredCapability["settings"]>;
type StoredSettingsRejectArray = Rejects<unknown[], StoredCapability["settings"]>;
type StoredSettingsRejectProperties = Rejects<
  { unexpected: boolean },
  StoredCapability["settings"]
>;
type UpdateSettingsAcceptEmptyObject = Assert<IsAssignable<{}, UpdatedCapability["settings"]>>;
type UpdateSettingsRejectString = Rejects<string, UpdatedCapability["settings"]>;
type UpdateSettingsRejectProperties = Rejects<
  { unexpected: boolean },
  UpdatedCapability["settings"]
>;
