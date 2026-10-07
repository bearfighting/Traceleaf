import capabilityManifest from "../../../../protocol/capabilities/capabilities.json";
import { CAPABILITY_LABELS } from "../../lib/configuration-api/types";

import type { CapabilityResponse } from "../../lib/configuration-api/types";

export type CapabilityDraft = CapabilityResponse["configuration"]["capabilities"];

export function capabilityToggleError(capabilities: CapabilityDraft, id: string, enabled: boolean) {
  if (id === "page_views") return "Page Views is required and cannot be disabled.";
  if (enabled) {
    const dependencies =
      capabilityManifest.capabilities.find((item) => item.id === id)?.depends_on ?? [];
    const missing = dependencies.filter((dependency) => !capabilities[dependency]?.enabled);

    return missing.length
      ? `Enable ${missing.map((key) => CAPABILITY_LABELS[key]).join(", ")} first.`
      : null;
  }
  const dependents = capabilityManifest.capabilities
    .filter((item) => capabilities[item.id]?.enabled && item.depends_on.includes(id))
    .map((item) => CAPABILITY_LABELS[item.id]);

  return dependents.length
    ? `Disable dependent capabilities first: ${dependents.join(", ")}.`
    : null;
}

export function updateCapabilityDraft(
  capabilities: CapabilityDraft,
  id: string,
  enabled: boolean,
): CapabilityDraft {
  if (capabilityToggleError(capabilities, id, enabled)) return capabilities;

  return { ...capabilities, [id]: { ...capabilities[id], enabled } };
}
