import { describe, expect, it } from "vitest";

import { capabilityToggleError, updateCapabilityDraft } from "./capability-domain";

const capabilities = {
  page_views: { enabled: true, settings: {} },
  browser_context: { enabled: true, settings: {} },
  anonymous_visitors: { enabled: false, settings: {} },
  sessions: { enabled: false, settings: {} },
  dimensions: { enabled: false, settings: {} },
  custom_events: { enabled: false, settings: {} },
  web_vitals: { enabled: false, settings: {} },
  conversions: { enabled: false, settings: {} },
  funnels: { enabled: false, settings: {} },
  geo: { enabled: false, settings: {} },
};

describe("capability draft rules", () => {
  it("locks Page Views as the required baseline", () => {
    expect(capabilityToggleError(capabilities, "page_views", false)).toBe(
      "Page Views is required and cannot be disabled.",
    );
    expect(updateCapabilityDraft(capabilities, "page_views", false)).toBe(capabilities);
  });

  it("reports missing dependencies when enabling a capability", () => {
    expect(capabilityToggleError(capabilities, "sessions", true)).toBe(
      "Enable Anonymous Visitors first.",
    );
  });

  it("protects enabled dependents when disabling a dependency", () => {
    const draft = {
      ...capabilities,
      anonymous_visitors: { enabled: true, settings: {} },
      sessions: { enabled: true, settings: {} },
    };
    expect(capabilityToggleError(draft, "anonymous_visitors", false)).toBe(
      "Disable dependent capabilities first: Sessions.",
    );
  });

  it("updates valid drafts immutably", () => {
    const next = updateCapabilityDraft(capabilities, "anonymous_visitors", true);
    expect(next.anonymous_visitors.enabled).toBe(true);
    expect(capabilities.anonymous_visitors.enabled).toBe(false);
  });
});
